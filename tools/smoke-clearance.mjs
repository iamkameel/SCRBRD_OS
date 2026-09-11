#!/usr/bin/env node
/**
 * Has the man driving the U14s on Saturday been checked?
 *
 * Every adult the platform puts near a child is somebody the school is
 * answerable for having checked. The checks existed; the record of them did
 * not. This walk proves the register and what it governs:
 *
 *   1. THE REGISTER IS THE OFFICE'S, at the school, and nobody else's — not
 *      the coach's, not a parent's, not a watcher's. It lists the gaps first.
 *   2. A PERSON SEES THEIR OWN and not their colleague's.
 *   3. THE OFFICE RECORDS A CLEARANCE and the request supplies no verifier:
 *      the trigger stamps who saw the document from the session.
 *   4. A CLEARANCE IS NEVER EDITED. It is revoked, with a reason, and stays.
 *   5. A DRIVER WHOSE CHECK HAS LAPSED DOES NOT TAKE A SIDE; one nobody has
 *      recorded is missing on the register, not refused on the road.
 *   6. A REFERENCE NUMBER IS A RESTRICTED FIELD: every read of one is logged.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-clearance.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";

const PORT = 8866;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const HIL = "11111111-1111-1111-1111-111111111111";
const WES = "22222222-2222-2222-2222-222222222222";
const COACH   = "88888888-0000-0000-0000-000000000004";   // 1XI coach, first aid expiring
const COACH2  = "88888888-0000-0000-0000-00000000000a";   // 2XI coach, police lapsed, no first aid
const DRIVER  = "88888888-0000-0000-0000-000000000017";
const WESCOACH= "88888888-0000-0000-0000-00000000001a";   // nothing recorded

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-clearance-secret" },
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
  method: "POST", body: { email, deviceId: "device-clearance" } })).body?.token;
const register = async (school, tok) => (await api(`/api/read/clearance_register?schoolId=${school}`, { token: tok })).body?.rows ?? [];
const of = async (person, tok) => (await api(`/api/read/clearances?personId=${person}`, { token: tok })).body?.rows ?? [];
const mine = async (tok) => (await api(`/api/read/my_clearances`, { token: tok })).body?.rows ?? [];
const record = (tok, body) => api("/api/clearances", { method: "POST", token: tok, body });
const revoke = (id, tok, reason = "Certificate found to be a photocopy") =>
  api(`/api/clearances/${id}/revoke`, { method: "POST", token: tok, body: { reason } });
const trip = (m, tok, body) => api(`/api/matches/${m}/trip`, { method: "POST", token: tok, body });

const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;
const iso = (d) => d.toISOString().slice(0, 10);
const daysFromNow = (n) => new Date(Date.now() + n * 864e5);
const row = (rows, person, kind) => rows.find((r) => r.person_id === person && r.kind === kind);

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  const coach     = await login("coach@example.invalid");
  const coach2    = await login("coach2@example.invalid");
  const parent    = await login("parent@example.invalid");
  const watcher   = await login("watcher@example.invalid");
  const medic     = await login("medical@example.invalid");
  const registrar = await login("registrar@example.invalid");   // schooladmin: read + manage
  const head      = await login("sarah@example.invalid");       // directorofsport: read + manage
  const principal = await login("principal@example.invalid");
  const wesAdmin  = await login("registrar.wes@example.invalid");
  const driver    = await login("driver@example.invalid");
  const idOf = async (email) => (await q(`select id from app_user where email = $1`, [email]))[0].id;

  group("The register is the office's, and it lists the gaps first");
  {
    const reg = await register(HIL, registrar);
    ok("the office reads the school's register", reg.length >= 12);
    ok("...one row per adult, role and required check",
       new Set(reg.map((r) => `${r.person_id}|${r.role}|${r.kind}`)).size === reg.length);
    ok("...the director of sport too", (await register(HIL, head)).length === reg.length);
    ok("...and the principal", (await register(HIL, principal)).length === reg.length);
    ok("a coach reads no register", (await register(HIL, coach)).length === 0);
    ok("a parent reads no register", (await register(HIL, parent)).length === 0);
    ok("a spectator reads no register", (await register(HIL, watcher)).length === 0);
    ok("the physio reads no register", (await register(HIL, medic)).length === 0);
    ok("another school's office reads nothing of this one", (await register(HIL, wesAdmin)).length === 0);
    ok("...and its own register names its unchecked coach",
       (await register(WES, wesAdmin)).filter((r) => r.person_id === WESCOACH).every((r) => r.status === "missing")
       && (await register(WES, wesAdmin)).some((r) => r.person_id === WESCOACH));
    // The words.
    ok("a check with sixty days or fewer reads as expiring", row(reg, COACH, "first_aid")?.status === "expiring");
    ok("a check that ran out reads as expired", row(reg, COACH2, "police_clearance")?.status === "expired");
    ok("a check nobody recorded reads as missing", row(reg, COACH2, "first_aid")?.status === "missing");
    ok("a check with time left reads as current", row(reg, DRIVER, "driving_permit")?.status === "current");
    ok("...with the date it lapses", /^\d{4}-\d{2}-\d{2}/.test(String(row(reg, DRIVER, "driving_permit")?.expires_on ?? "")));
    ok("the gaps come first", ["missing", "expired"].includes(reg[0].status) && reg.at(-1).status === "current");
    ok("a role with no requirement is not on it", !reg.some((r) => ["guardian", "player", "scout", "spectator"].includes(r.role)));
    ok("the driver is on it three ways", reg.filter((r) => r.person_id === DRIVER).length === 3);
    // Only the seeded rows: no verifier, and the register says so rather than inventing one.
    ok("a seeded row has no verifier", (await q(`select count(*)::int c from adult_clearance where verified_by is not null`))[0].c === 0);
  }

  group("A person sees their own, and not their colleague's");
  {
    const own = await mine(coach);
    ok("a coach reads his own clearances", own.length === 3);
    ok("...with the school that made them", own.every((r) => r.school_name));
    ok("...and the word for each", own.some((r) => r.status === "expiring") && own.filter((r) => r.status === "current").length === 2);
    ok("the same rows through the person read", (await of(COACH, coach)).length === 3);
    ok("...but not his colleague's", (await of(COACH2, coach)).length === 0);
    ok("...while the office reads both", (await of(COACH2, registrar)).length === 2 && (await of(COACH, registrar)).length === 3);
    ok("a parent has none and reads none", (await mine(parent)).length === 0 && (await of(COACH, parent)).length === 0);
    ok("everyone signed in can read what a role must hold",
       ((await api("/api/read/clearance_requirements", { token: watcher })).body?.rows ?? []).some((r) => r.role === "driver" && r.kind === "driving_permit"));
    ok("...and nobody writes it",
       !(await q(`set local role scrbrd_app; insert into clearance_requirement values ('spectator','first_aid')`).then(() => true).catch(() => false)));
  }

  group("The office records a clearance, and the session says who saw it");
  {
    const body = { personId: COACH2, schoolId: HIL, kind: "first_aid", reference: "FA-L1-2026-7781",
                   issuedOn: iso(daysFromNow(-3)), expiresOn: iso(daysFromNow(360)), note: "Level 1, seen in person" };
    const r = await record(registrar, body);
    ok("the office records a first aid certificate", r.status === 200 && r.body?.id);
    ok("...stamped with who saw it, from the session", r.body?.verifiedBy === await idOf("registrar@example.invalid"));
    ok("...and the register now reads current", row(await register(HIL, registrar), COACH2, "first_aid")?.status === "current");
    ok("a verifier in the request is ignored",
       (await record(head, { ...body, personId: COACH, kind: "coaching_accreditation", verifiedBy: COACH2 })).body?.verifiedBy === await idOf("sarah@example.invalid"));
    ok("a coach cannot record his own", [403, 401].includes((await record(coach, { ...body, personId: COACH })).status));
    ok("...nor a colleague's", [403, 401].includes((await record(coach, body)).status));
    ok("another school's office cannot record at this one", [403, 401].includes((await record(wesAdmin, body)).status));
    ok("...but records at its own", (await record(wesAdmin, { ...body, personId: WESCOACH, schoolId: WES })).status === 200);
    ok("a kind outside the vocabulary is refused", (await record(registrar, { ...body, kind: "cv" })).status === 400);
    ok("a clearance without a re-check date is not a clearance", (await record(registrar, { ...body, expiresOn: "" })).status === 400);
    ok("an expiry before the issue date is refused", (await record(registrar, { ...body, expiresOn: iso(daysFromNow(-10)) })).status === 400);
    ok("an expiry six years out is a typo in the year", (await record(registrar, { ...body, expiresOn: iso(daysFromNow(6 * 366)) })).status === 422);
    ok("a bad date is refused by name", (await record(registrar, { ...body, issuedOn: "3 March" })).body?.error === "issued_on_must_be_yyyy_mm_dd");
    ok("a person that does not exist is a 404", (await record(registrar, { ...body, personId: "00000000-0000-0000-0000-00000000dead" })).status === 404);
  }

  group("A clearance is never edited — it is revoked, with a reason, and stays");
  {
    const id = (await q(`select id from adult_clearance where person_id = $1 and kind = 'police_clearance' and revoked_at is null`, [COACH]))[0].id;
    ok("the date on a verified row cannot be moved",
       !(await q(`update adult_clearance set expires_on = expires_on + 365 where id = $1`, [id]).then(() => true).catch(() => false)));
    ok("...nor its reference",
       !(await q(`update adult_clearance set reference = 'PCC-0000' where id = $1`, [id]).then(() => true).catch(() => false)));
    ok("a coach cannot revoke his own", (await revoke(id, coach)).body?.revoked === 0);
    ok("a revocation needs a reason", (await revoke(id, registrar, "")).status === 400);
    const r = await revoke(id, registrar);
    ok("the office revokes it", r.body?.revoked === 1);
    const h = (await q(`select revoked_at, revoked_by, revoked_reason from adult_clearance where id = $1`, [id]))[0];
    ok("...stamped with who and why", h.revoked_at && h.revoked_by === await idOf("registrar@example.invalid") && /photocopy/.test(h.revoked_reason));
    ok("...and the register reads revoked", row(await register(HIL, registrar), COACH, "police_clearance")?.status === "revoked");
    ok("...while his history keeps the row", (await of(COACH, registrar)).some((c) => c.id === id && c.status === "revoked"));
    ok("revoking it again does nothing and says nothing", (await revoke(id, registrar)).body?.revoked === 0);
    ok("a revoked row is not un-revoked",
       !(await q(`update adult_clearance set revoked_at = null, revoked_reason = null where id = $1`, [id]).then(() => true).catch(() => false)));
    const again = await record(registrar, { personId: COACH, schoolId: HIL, kind: "police_clearance", reference: "PCC-2026-099120",
                                            issuedOn: iso(daysFromNow(-1)), expiresOn: iso(daysFromNow(364)) });
    ok("a new one is recorded in its place", again.status === 200);
    ok("...and the register reads current again", row(await register(HIL, registrar), COACH, "police_clearance")?.status === "current");
    ok("...with both in his history", (await of(COACH, registrar)).filter((c) => c.kind === "police_clearance").length === 2);
  }

  group("A driver whose check has lapsed does not take a side");
  {
    const office = registrar;
    const fixture = async () => (await q(
      `insert into match (school_id, team_code, opponent, starts_at, sport, format, overs)
       values ($1,'1XI','Kearsney', now() + interval '5 days','cricket','T20',20) returning id`, [HIL]))[0].id;
    const veh = (await q(`select id from vehicle where school_id = $1 and active limit 1`, [HIL]))[0];
    const arrange = (m) => trip(m, office, { vehicleId: veh.id, driverId: DRIVER, departAt: daysFromNow(5).toISOString(), seatsTaken: 10 });

    ok("a cleared driver is put on a trip", (await arrange(await fixture())).status === 200);
    const permit = (await q(`select id from adult_clearance where person_id = $1 and kind = 'driving_permit' and revoked_at is null`, [DRIVER]))[0].id;
    await revoke(permit, office, "Permit suspended pending points hearing");
    const m2 = await fixture();
    const refused = await arrange(m2);
    ok("with his permit revoked he is not", refused.status === 422);
    ok("...and the refusal names him and the check", /B Ngcobo/.test(refused.body?.detail ?? "") && /driving permit/.test(refused.body?.detail ?? "") && /revoked/.test(refused.body?.detail ?? ""));
    ok("...and no trip was written", (await q(`select count(*)::int c from trip where match_id = $1`, [m2]))[0].c === 0);
    ok("the bus still goes, without him", (await trip(m2, office, { vehicleId: veh.id, departAt: daysFromNow(5).toISOString(), seatsTaken: 10 })).status === 200);
    // Lapsed, not revoked: the same door, a different sentence.
    await record(office, { personId: DRIVER, schoolId: HIL, kind: "driving_permit", reference: "PrDP-G-0000001",
                           issuedOn: iso(daysFromNow(-400)), expiresOn: iso(daysFromNow(-7)) });
    const m3 = await fixture();
    const lapsed = await arrange(m3);
    ok("with a lapsed permit he is not either", lapsed.status === 422 && /expired on/.test(lapsed.body?.detail ?? ""));
    ok("...naming the date it lapsed", new RegExp(iso(daysFromNow(-7))).test(lapsed.body?.detail ?? ""));
    // Swapping a driver onto an existing trip goes through the same door.
    const t = (await q(`select id from trip where match_id = $1`, [m2]))[0];
    ok("he cannot be swapped onto a trip that already exists either",
       !(await q(`update trip set driver_id = $2 where id = $1`, [t.id, DRIVER]).then(() => true).catch(() => false)));
    // Renewed.
    await record(office, { personId: DRIVER, schoolId: HIL, kind: "driving_permit", reference: "PrDP-G-4471821",
                           issuedOn: iso(daysFromNow(-1)), expiresOn: iso(daysFromNow(700)) });
    ok("with the renewal recorded he drives again", (await arrange(await fixture())).status === 200);
    // Nobody recorded anything: missing, on the register, not refused on the road.
    const nobody = await idOf("bursar@example.invalid");
    const m5 = await fixture();
    ok("a driver nobody has checked is not refused", (await trip(m5, office, { vehicleId: veh.id, driverId: nobody, departAt: daysFromNow(5).toISOString(), seatsTaken: 10 })).status === 200);
    ok("...because the register is where that gap is loud", row(await register(HIL, registrar), DRIVER, "police_clearance")?.status === "current");
    ok("the refusal was not the driver's own read", (await mine(driver)).length >= 3);
  }

  group("A reference number is a restricted field");
  {
    const before = (await q(`select count(*)::int c from access_log where resource in ('clearance_register','clearances')`))[0].c;
    await register(HIL, registrar);
    await of(COACH, coach);
    const after = (await q(`select count(*)::int c from access_log where resource in ('clearance_register','clearances')`))[0].c;
    ok("reading the register is logged", after >= before + 2);
    const last = (await q(`select person_id, resource, record_count from access_log where resource = 'clearance_register' order by occurred_at desc limit 1`))[0];
    ok("...against the reader", last.person_id === await idOf("registrar@example.invalid") && last.record_count > 0);
    ok("an empty read logs nothing", await (async () => {
      const b = (await q(`select count(*)::int c from access_log where resource = 'clearance_register'`))[0].c;
      await register(HIL, coach);
      return (await q(`select count(*)::int c from access_log where resource = 'clearance_register'`))[0].c === b;
    })());
  }

  ok("the server logged no errors", serverErr.join("").trim() === "");
  if (serverErr.length) console.log(serverErr.join("").slice(0, 600));
} catch (e) {
  fail++;
  console.log("  ✗ threw:", e.message);
} finally {
  server.kill();
  await pool.end();
}
console.log(`\n${"─".repeat(52)}\nCLEARANCE SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

#!/usr/bin/env node
/**
 * Who to ring when something happens to a child — and whether the bus is
 * insured to carry him.
 *
 * A minibus leaves for an away fixture and nobody aboard can reach a parent.
 * That was the state of the schema: the only contact was a JSON blob on the
 * player row behind player.pii.read, which the coach, the manager, the physio
 * and the driver do not hold — rightly, since it is the capability for the
 * child's FILE. The people around him on a Saturday need one thing from it.
 *
 *   1. THE ADULT ON THE BUS CAN REACH A PARENT, and the file stays closed:
 *      player.emergency.read is not player.pii.read.
 *   2. THE FAMILY KEEPS ITS OWN NUMBERS, and only its own.
 *   3. A REPLACED NUMBER IS RETIRED, NEVER DELETED.
 *   4. THE DRIVER IS REACHED THROUGH THE TRIP, on the day, and reads nothing
 *      otherwise — a school-wide driver must not hold every child's numbers.
 *   5. A GUARDIAN READING THE MANIFEST SEES THEIR OWN CHILD AND NOBODY ELSE'S.
 *   6. A KNOWN-LAPSED VEHICLE DOES NOT CARRY A SIDE; an unrecorded date is
 *      "unknown", not "fine" and not "refused".
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-contacts.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";

const PORT = 8865;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const HIL = "11111111-1111-1111-1111-111111111111";
const CHILD = "aaaaaaaa-0000-0000-0000-000000000005";   // R Pillay, 1XI — two seeded contacts

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-contacts-secret" },
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
  method: "POST", body: { email, deviceId: "device-contacts" } })).body?.token;
const contacts = async (id, tok) => (await api(`/api/read/emergency_contacts?playerId=${id}`, { token: tok })).body?.rows ?? [];
const manifest = async (trip, tok) => (await api(`/api/read/trip_contacts?tripId=${trip}`, { token: tok })).body?.rows ?? [];
const add = (id, tok, body) => api(`/api/players/${id}/emergency-contacts`, { method: "POST", token: tok, body });
const retire = (id, tok) => api(`/api/emergency-contacts/${id}/retire`, { method: "POST", token: tok });
const vehicle = (tok, body) => api("/api/vehicles", { method: "POST", token: tok, body });
const trip = (m, tok, body) => api(`/api/matches/${m}/trip`, { method: "POST", token: tok, body });
const vehicles = async (tok) => (await api("/api/read/vehicles", { token: tok })).body?.rows ?? [];

const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;
const iso = (d) => d.toISOString().slice(0, 10);
const daysFromNow = (n) => new Date(Date.now() + n * 864e5);
const CONTACT = { priority: 1, name: "D Pillay", relationship: "mother", phone: "+27 82 000 0005" };

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  const coach     = await login("coach@example.invalid");      // 1XI: emergency.read, no pii.read
  const coach2    = await login("coach2@example.invalid");     // 2XI
  const medic     = await login("medical@example.invalid");
  const parent    = await login("parent@example.invalid");     // guardian of R Pillay
  const otherMum  = await login("parent.whitfield@example.invalid");
  const watcher   = await login("watcher@example.invalid");
  const scout     = await login("analyst@example.invalid");
  const registrar = await login("registrar@example.invalid");
  const head      = await login("sarah@example.invalid");
  const driver    = await login("driver@example.invalid");     // school-wide transport.drive
  const idOf = async (email) => (await q(`select id from app_user where email = $1`, [email]))[0].id;

  group("The adult on the bus can reach a parent, and the file stays closed");
  {
    const c = await contacts(CHILD, coach);
    ok("the coach reads his player's contacts", c.length === 2);
    ok("...in the order to ring them", c[0]?.priority === 1 && c[0]?.relationship === "mother" && c[1]?.priority === 2);
    ok("...with a number he can dial", /^\+27 82/.test(c[0]?.phone ?? ""));
    ok("...and the note that says when", /after seven/.test(c[1]?.note ?? ""));
    // The capability is NOT the file. The same coach still cannot read the
    // child's personal record, which is what player.pii.read is for.
    const file = (await api(`/api/read/players`, { token: coach })).body?.rows?.find((r) => r.id === CHILD);
    ok("...while the child's file is still masked from him", file && file.id_number == null && file.address == null);
    ok("the physio reads them too", (await contacts(CHILD, medic)).length === 2);
    ok("the coach of another side reads nothing", (await contacts(CHILD, coach2)).length === 0);
    ok("a spectator reads nothing", (await contacts(CHILD, watcher)).length === 0);
    ok("a scout reads nothing", (await contacts(CHILD, scout)).length === 0);
    ok("a guardian reads their own child's", (await contacts(CHILD, parent)).length === 2);
    ok("...and not another family's", (await contacts("aaaaaaaa-0000-0000-0000-000000000001", parent)).length === 0);
    // Every read of a number is logged, like every other restricted read.
    const before = (await q(`select count(*)::int c from access_log where resource = 'emergency_contacts'`))[0].c;
    await contacts(CHILD, coach);
    ok("...and each read of a number is logged",
       (await q(`select count(*)::int c from access_log where resource = 'emergency_contacts'`))[0].c === before + 1);
  }

  group("The family keeps its own numbers, and only its own");
  {
    const r = await add(CHILD, parent, { priority: 3, name: "T Pillay", relationship: "sibling", phone: "082 000 0555" });
    ok("a guardian adds a contact for their own child", r.status === 200);
    ok("...a local number without a country code is accepted", r.body?.phone === "082 000 0555");
    ok("...stamped from the session", (await q(`select created_by from emergency_contact where id = $1`, [r.body.id]))[0].created_by === await idOf("parent@example.invalid"));
    ok("...with the school derived from the child, not asserted",
       (await q(`select school_id from emergency_contact where id = $1`, [r.body.id]))[0].school_id === HIL);
    ok("a guardian cannot add one for another child",
       [403, 401].includes((await add("aaaaaaaa-0000-0000-0000-000000000001", parent, CONTACT)).status));
    ok("a coach may read but not keep", [403, 401].includes((await add(CHILD, coach, { ...CONTACT, priority: 2 })).status));
    ok("the office can", (await add("aaaaaaaa-0000-0000-0000-000000000003", registrar, CONTACT)).status === 200);
    ok("the director of sport can", (await add("aaaaaaaa-0000-0000-0000-000000000002", head, CONTACT)).status === 200);
    ok("a relationship outside the vocabulary is refused", (await add(CHILD, parent, { ...CONTACT, priority: 3, relationship: "neighbour" })).status === 400);
    ok("a number that is not a number is refused", (await add(CHILD, parent, { ...CONTACT, priority: 3, phone: "call the office" })).status === 400);
    ok("a fourth position does not exist", (await add(CHILD, parent, { ...CONTACT, priority: 4 })).status === 400);
    ok("a bad email is refused", (await add(CHILD, parent, { ...CONTACT, priority: 3, email: "not-an-email" })).status === 400);
  }

  group("A replaced number is retired, never deleted");
  {
    const before = (await contacts(CHILD, parent)).find((c) => c.priority === 1);
    const r = await add(CHILD, parent, { ...CONTACT, phone: "+27 82 999 0005" });
    ok("adding at a taken position replaces the live contact", r.status === 200 && r.body?.phone === "+27 82 999 0005");
    ok("...the read shows one contact at that position", (await contacts(CHILD, parent)).filter((c) => c.priority === 1).length === 1);
    const hist = await q(`select active, retired_at, retired_by, phone from emergency_contact
                           where player_id = $1 and priority = 1 order by created_at`, [CHILD]);
    ok("...and the old one is still there, retired", hist.length === 2 && hist[0].active === false && hist[0].retired_at !== null);
    ok("...stamped with who retired it", hist[0].retired_by === await idOf("parent@example.invalid"));
    ok("...and its number kept", hist[0].phone === before?.phone);
    // The route retires before it inserts, but the position is held by the
    // table itself — a second live contact at a taken position is refused
    // whoever writes it and however they write it.
    ok("a second live contact at a taken position is refused at the database",
       !(await q(`insert into emergency_contact (player_id, priority, name, relationship, phone)
                  values ($1, 1, 'E Pillay', 'father', '+27 82 000 0006')`, [CHILD]).then(() => true).catch(() => false)));
    ok("...and the live one is unchanged", (await contacts(CHILD, parent)).filter((c) => c.priority === 1).length === 1);
    const r2 = await retire(r.body.id, parent);
    ok("a contact can be retired on its own", r2.body?.retired === 1);
    ok("retiring another family's contact does nothing and says nothing",
       (await retire((await q(`select id from emergency_contact where player_id = 'aaaaaaaa-0000-0000-0000-000000000001' and active limit 1`))[0].id, parent)).body?.retired === 0);
    ok("a retired contact is not reactivated",
       !(await q(`update emergency_contact set active = true where id = $1`, [hist[0].id ?? r.body.id]).then(() => true).catch(() => false)));
  }

  group("The driver is reached through the trip, on the day, and not otherwise");
  {
    ok("a driver holds no capability on a child's contacts", (await contacts(CHILD, driver)).length === 0);
    const veh = (await q(`select id from vehicle where school_id = $1 limit 1`, [HIL]))[0];
    const fixture = async (days) => (await q(
      `insert into match (school_id, team_code, opponent, starts_at, sport, format, overs)
       values ($1,'1XI','Kearsney', now() + ($2 || ' days')::interval,'cricket','T20',20) returning id`,
      [HIL, String(days)]))[0].id;
    const pick = (m, id) => q(`insert into match_squad (match_id, player_id, side) values ($1,$2,'home')`, [m, id]);

    const today = await fixture(0);
    await pick(today, CHILD);
    const t1 = await trip(today, registrar, { vehicleId: veh.id, departAt: new Date(Date.now() + 36e5).toISOString(), seatsTaken: 12 });
    ok("a trip leaving today is arranged", t1.status === 200);
    const m1 = await manifest(t1.body.id, driver);
    ok("...and the driver reads its manifest", m1.length > 0 && m1.every((r) => r.player_id === CHILD));
    ok("...with a parent's number on it", /^\+27/.test(m1[0]?.phone ?? ""));

    const later = await fixture(12);
    await pick(later, CHILD);
    const t2 = await trip(later, registrar, { vehicleId: veh.id, departAt: daysFromNow(12).toISOString(), seatsTaken: 12 });
    ok("a trip a fortnight away is arranged", t2.status === 200);
    ok("...and is not yet the driver's business", (await manifest(t2.body.id, driver)).length === 0);
    ok("the coach reads either manifest", (await manifest(t2.body.id, coach)).length > 0);
    // Per child, not per bus: a guardian on the manifest sees their own.
    await pick(today, "aaaaaaaa-0000-0000-0000-000000000001");   // James Whitfield, who has a seeded contact
    const mp = await manifest(t1.body.id, parent);
    ok("a guardian reading the manifest sees their own child", mp.some((r) => r.player_id === CHILD));
    ok("...and nobody else's", mp.every((r) => r.player_id === CHILD));
    ok("...while the coach sees both", new Set((await manifest(t1.body.id, coach)).map((r) => r.player_id)).size === 2);
    ok("a spectator reads no manifest", (await manifest(t1.body.id, watcher)).length === 0);
    ok("a manifest read is logged", (await q(`select count(*)::int c from access_log where resource = 'trip_contacts'`))[0].c > 0);
  }

  group("A known-lapsed vehicle does not carry a side");
  {
    const coord = registrar;   // schooladmin holds transport.manage
    const lapsed = await vehicle(coord, { schoolId: HIL, registration: "NPS 999 KZ", description: "Old Hiace", kind: "minibus",
      capacity: 14, insuranceExpiresOn: iso(daysFromNow(-1)), roadworthyExpiresOn: iso(daysFromNow(200)) });
    ok("a vehicle can be recorded with its cover dates", lapsed.status === 200 && String(lapsed.body?.insurance_expires_on ?? lapsed.body?.insuranceExpiresOn ?? "").length > 0);
    const m = (await q(`insert into match (school_id, team_code, opponent, starts_at, sport, format, overs)
                         values ($1,'1XI','Michaelhouse', now() + interval '6 days','cricket','T20',20) returning id`, [HIL]))[0].id;
    const refused = await trip(m, registrar, { vehicleId: lapsed.body.id, departAt: daysFromNow(6).toISOString(), seatsTaken: 10 });
    ok("a trip on it is refused", refused.status === 422);
    ok("...naming the vehicle and the date", /NPS 999 KZ/.test(refused.body?.detail ?? "") && /insurance expired on/.test(refused.body?.detail ?? ""));
    ok("...and no trip was written", (await q(`select count(*)::int c from trip where match_id = $1`, [m]))[0].c === 0);

    const unknown = await vehicle(coord, { schoolId: HIL, registration: "NPS 777 KZ", description: "New Quantum", kind: "minibus", capacity: 22 });
    ok("a vehicle with no cover recorded is not refused", (await trip(m, registrar, { vehicleId: unknown.body.id, departAt: daysFromNow(6).toISOString(), seatsTaken: 10 })).status === 200);
    const vs = await vehicles(coord);
    const state = (reg) => vs.find((v) => v.registration === reg)?.cover_state;
    ok("...but the list says so", state("NPS 777 KZ") === "unknown");
    ok("a lapsed vehicle reads as expired", state("NPS 999 KZ") === "expired");
    await vehicle(coord, { schoolId: HIL, registration: "NPS 999 KZ", description: "Old Hiace", kind: "minibus", capacity: 14,
      insuranceExpiresOn: iso(daysFromNow(10)), roadworthyExpiresOn: iso(daysFromNow(200)) });
    ok("a renewal that is about to lapse reads as expiring", (await vehicles(coord)).find((v) => v.registration === "NPS 999 KZ")?.cover_state === "expiring");
    ok("the seeded fleet reads as current", vs.filter((v) => !/NPS (999|777)/.test(v.registration)).every((v) => v.cover_state === "current"));
    ok("a cover date that is not a date is refused",
       (await vehicle(coord, { schoolId: HIL, registration: "NPS 555 KZ", description: "x", kind: "car", capacity: 4, insuranceExpiresOn: "March" })).status === 400);
    // Marking the bus departed is not re-arranging it: a lapse discovered
    // after arranging must not stop the record of what happened.
    const t = (await q(`select id from trip where match_id = $1`, [m]))[0];
    await q(`update vehicle set insurance_expires_on = current_date - 1 where id = $1`, [unknown.body.id]);
    ok("a driver's mark is not refused by a lapse found later",
       (await q(`update trip set departed_at = now() where id = $1 returning id`, [t.id])).length === 1);
  }

} catch (e) {
  fail++; console.log("\n  ✗ threw:", e.message);
  if (serverErr.length) console.log(serverErr.join("").slice(-1500));
} finally {
  await pool.end().catch(() => {});
  server.kill();
  console.log("\n" + "─".repeat(52));
  console.log(`CONTACTS SMOKE: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

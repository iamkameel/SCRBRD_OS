#!/usr/bin/env node
/**
 * Getting the side there, and three capabilities that had nothing to act on.
 *
 * transport.read, transport.manage and transport.drive were declared, bundled
 * into ten roles, and gated a Logistics destination whose vehicles came off a
 * mock array hung on the staff record. Nothing in the database had ever heard
 * of a bus, so none of the three could refuse anything or permit anything.
 *
 *   1. A TRIP BELONGS TO A FIXTURE, and that anchor is what finally gives
 *      transport.drive somewhere to live.
 *   2. A DRIVER REPORTS, AND DOES NOT ARRANGE. Marking a bus departed is not
 *      the same authority as re-timing it or swapping the vehicle.
 *   3. THE BUS HAS TO FIT. A fourteen-seater carrying fifteen boys is a safety
 *      failure, and it is refused by the database rather than by a form.
 *   4. FLEETS DO NOT CROSS SCHOOLS.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-transport.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";

const PORT = 8834;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const HIL = "11111111-1111-1111-1111-111111111111";
const WES = "22222222-2222-2222-2222-222222222222";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-transport-secret" },
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
  method: "POST", body: { email, deviceId: "device-transport" } })).body?.token;

const addVehicle = (token, body) => api("/api/vehicles", { method: "POST", token, body });
const arrange = (matchId, token, body) =>
  api(`/api/matches/${matchId}/trip`, { method: "POST", token, body });
const mark = (tripId, token, event) =>
  api(`/api/trips/${tripId}/mark`, { method: "POST", token, body: { event } });
const trips = async (matchId, token) =>
  (await api(`/api/read/trips?matchId=${matchId}`, { token })).body?.rows ?? [];
const fleet = async (token) => (await api("/api/read/vehicles", { token })).body?.rows ?? [];

const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  const office  = await login("registrar@example.invalid");   // transport.manage
  const head    = await login("sarah@example.invalid");        // transport.read
  const driver  = await login("driver@example.invalid");       // transport.drive
  const parent  = await login("parent@example.invalid");       // transport.read
  const medic   = await login("medical@example.invalid");      // NO transport at all
  const wesAdmin = await login("registrar.wes@example.invalid");
  const driverId = (await q(`select id from app_user where email='driver@example.invalid'`))[0].id;

  const m = (await q(
    `insert into match (school_id, team_code, opponent, starts_at, format, overs, status)
     values ($1,'1XI','Michaelhouse', now() + interval '2 days','T20',20,'scheduled') returning id`,
    [HIL]))[0].id;

  group("The fleet is real, and it is the school's");
  const f = await fleet(head);
  ok("the seeded fleet reads back", f.length === 3);
  ok("...with seats, not a mock array", f.every((v) => v.capacity > 0));
  ok("a parent can see the fleet — that is the point of the screen", (await fleet(parent)).length === 3);
  ok("somebody with no transport capability sees none", (await fleet(medic)).length === 0);
  ok("another school's office sees none of ours",
     !(await fleet(wesAdmin)).some((v) => v.registration === "KZN 482 GP"));

  ok("the office can add a vehicle",
     (await addVehicle(office, { schoolId: HIL, registration: "KZN 900 AA",
        description: "Hiace 10-seater", kind: "minibus", capacity: 10 })).status === 200);
  ok("a coach cannot",
     [403, 401].includes((await addVehicle(await login("coach@example.invalid"),
        { schoolId: HIL, registration: "KZN 901 AA", description: "x", kind: "van", capacity: 8 })).status));
  ok("nor another school's office, for our school",
     [403, 401].includes((await addVehicle(wesAdmin, { schoolId: HIL, registration: "KZN 902 AA",
        description: "x", kind: "van", capacity: 8 })).status));
  ok("a nonsense capacity is refused",
     (await addVehicle(office, { schoolId: HIL, registration: "KZN 903 AA",
        description: "x", kind: "van", capacity: 0 })).status === 400);

  group("A trip belongs to a fixture");
  const big = f.find((v) => v.capacity === 30);
  const small = f.find((v) => v.capacity === 14);
  const t = await arrange(m, office, {
    vehicleId: big.id, driverId, departAt: new Date(Date.now() + 36e5).toISOString(),
    pickup: "Top gate", seatsTaken: 16 });
  ok("the office can arrange a trip", t.status === 200);
  ok("...and it names the fixture", t.body?.match_id === m);
  ok("...with the school taken from the match, not the request",
     (await q(`select school_id from trip where id=$1`, [t.body.id]))[0].school_id === HIL);

  ok("a coach can see their side's transport", (await trips(m, await login("coach@example.invalid"))).length === 1);
  ok("a parent can see it too", (await trips(m, parent)).length === 1);
  ok("somebody with no transport capability cannot", (await trips(m, medic)).length === 0);
  ok("the state is one word, derived once", (await trips(m, head))[0]?.state === "scheduled");

  group("The bus has to fit, and it has to be ours");
  ok("more passengers than seats is refused",
     (await arrange(m, office, { vehicleId: small.id, seatsTaken: 15 })).status === 422);
  ok("...and the refusal says the numbers",
     /14|15/.test((await arrange(m, office, { vehicleId: small.id, seatsTaken: 15 })).body?.detail ?? ""));
  ok("exactly full is fine",
     (await arrange(m, office, { vehicleId: small.id, seatsTaken: 14 })).status === 200);
  ok("the same bus twice on one fixture is refused",
     (await arrange(m, office, { vehicleId: big.id, seatsTaken: 4 })).status === 409);
  {
    // Another school's vehicle, written straight in so the check being tested
    // is the trigger and not the read policy that would hide it anyway.
    const theirs = (await q(
      `insert into vehicle (school_id, registration, description, kind, capacity)
       values ($1,'ZZZ 111 GP','Their bus','bus',40) returning id`, [WES]))[0].id;
    ok("another school's vehicle is refused",
       (await arrange(m, office, { vehicleId: theirs, seatsTaken: 4 })).status === 422);
    await q(`update vehicle set active = false where id = $1`,
            [(await q(`select id from vehicle where registration='KZN 900 AA'`))[0].id]);
    ok("a vehicle out of service is refused",
       (await arrange(m, office, {
         vehicleId: (await q(`select id from vehicle where registration='KZN 900 AA'`))[0].id,
         seatsTaken: 4 })).status === 422);
  }

  group("A driver reports, and does not arrange");
  const tripId = t.body.id;
  // THE POINT OF transport.drive, and of the fixture anchor underneath it.
  ok("a driver cannot arrange a trip",
     [403, 401].includes((await arrange(m, driver, { vehicleId: big.id, seatsTaken: 4 })).status));
  ok("nor add a vehicle",
     [403, 401].includes((await addVehicle(driver, { schoolId: HIL, registration: "KZN 904 AA",
        description: "x", kind: "van", capacity: 8 })).status));
  // And cannot change the row through the table either, which is what a write
  // policy on transport.drive would have allowed.
  ok("nor re-time the one they are driving",
     (await q(`select count(*)::int c from pg_policies
                where tablename='trip' and cmd in ('UPDATE','INSERT')
                  and (qual like '%transport.drive%' or with_check like '%transport.drive%')`))[0].c === 0);

  ok("the driver can say they have left", (await mark(tripId, driver, "departed")).status === 200);
  ok("...and the state moves", (await trips(m, head))[0]?.state === "under_way");
  ok("...but not twice", (await mark(tripId, driver, "departed")).status === 403);
  ok("the driver can say they have arrived", (await mark(tripId, driver, "arrived")).status === 200);
  ok("...and the state moves again", (await trips(m, head))[0]?.state === "arrived");
  ok("an unknown event is refused", (await mark(tripId, driver, "crashed")).status === 400);

  group("Arriving without leaving is somebody marking the wrong trip");
  {
    const other = (await q(
      `insert into match (school_id, team_code, opponent, starts_at, format, overs, status)
       values ($1,'2XI','Kearsney', now() + interval '4 days','T20',20,'scheduled') returning id`,
      [HIL]))[0].id;
    const t2 = await arrange(other, office, { driverId, seatsTaken: 11 });
    ok("a second trip is arranged", t2.status === 200);
    ok("arrived before departed is refused", (await mark(t2.body.id, driver, "arrived")).status === 403);
    ok("...and nothing was stamped",
       (await q(`select arrived_at from trip where id=$1`, [t2.body.id]))[0].arrived_at === null);

    // Somebody else's trip, at the same school. Being a driver is not being
    // THIS trip's driver — though a school-wide transport.drive assignment
    // legitimately reaches it, which is why the fixture anchor matters.
    const parentMark = await mark(t2.body.id, parent, "departed");
    ok("a parent cannot mark a bus departed", [403, 401].includes(parentMark.status));
    ok("the office can, standing in for a driver who did not",
       (await mark(t2.body.id, office, "departed")).status === 200);
  }

  group("Nothing here is a fiction");
  {
    // The gap this closes: every figure the Logistics screen showed was
    // computed in the browser over a mock array, so it was the same number for
    // every reader and true for none of them.
    const cols = await q(
      `select table_name, column_name from information_schema.columns
        where table_schema='public' and table_name in ('vehicle','trip')`);
    ok("a trip stores no derived state column",
       !cols.some((c) => c.table_name === "trip" && c.column_name === "state"));
    ok("...it is computed from the marks", (await trips(m, head))[0]?.state === "arrived");
    ok("the fleet is a table, not a column on staff",
       cols.some((c) => c.table_name === "vehicle" && c.column_name === "capacity")
       && !(await q(`select count(*)::int c from information_schema.columns
                      where table_name='staff' and column_name='vehicles'`))[0].c);
  }

} catch (e) {
  fail++; console.log("\n  ✗ threw:", e.message);
  if (serverErr.length) console.log(serverErr.join("").slice(-1500));
} finally {
  await pool.end().catch(() => {});
  server.kill();
  console.log("\n" + "─".repeat(52));
  console.log(`TRANSPORT SMOKE: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

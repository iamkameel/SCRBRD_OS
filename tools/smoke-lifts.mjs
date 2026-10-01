#!/usr/bin/env node
/**
 * Parent lift clubs, phase 1: the arrangement, through the API (SCRBRD-124).
 *
 * docs/design/SCRBRD-124_lift_clubs.md §8's walk: the policy, the
 * declaration, the offer (a round trip, made as one), the request, the
 * acceptance, the fixture moving under it, the driver standing behind it and
 * the family saying yes again. With the seed's own invented families: H
 * Whitfield drives, A Bekker asks for her son, N Cele — whose consent to
 * processing the seed leaves pending — is refused until the office records it
 * and then asks, R Pillay (a pupil) drives nothing and at sixteen asks nothing — then, put at
 * eighteen and still at school, asks for himself, reads his own seat and withdraws it (Kameel's
 * follow-up, 2026-10-01) — the 1XI coach and the office see what §5.1 gives them and nothing
 * more, and the owner's key sees nothing. db/99 §48 is the
 * fuller proof under the application role; this holds the routes to it:
 *
 *   1. TWO KEYS. Nothing until the platform grants the module AND the
 *      principal signs the school's policy (D17).
 *   2. A ROUND TRIP IS ONE ACT. Two offers from one form, in one transaction:
 *      a refused leg leaves neither.
 *   3. CONSENT PER BOY, PER LIFT, BY VERSION. The fixture moves: every seat
 *      waits on the driver, then on the family, then is confirmed again.
 *   4. NAMES AND NUMBERS THROUGH THE LOGGED DOORS ONLY, and a "no" is never
 *      switched off with the module.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-lifts.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";

const PORT = port(5470);
const BASE = `http://127.0.0.1:${PORT}`;
const HIL = "11111111-1111-1111-1111-111111111111";
const JAMES = "aaaaaaaa-0000-0000-0000-000000000001";   // James Whitfield, 1XI: the driver's son
const BEKKER = "aaaaaaaa-0000-0000-0000-000000000002";  // T Bekker, 1XI
const CELE = "aaaaaaaa-0000-0000-0000-000000000004";    // M Cele, 1XI
const PILLAY = "aaaaaaaa-0000-0000-0000-000000000005";  // R Pillay, 1XI, sixteen, his own account (put at eighteen below)

let pass = 0, fail = 0;
const ok = (/** @type {string} */ n, /** @type {unknown} */ c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-lifts-secret" },
  stdio: ["ignore", "pipe", "pipe"],
});
const serverErr = /** @type {string[]} */ ([]);
server.stderr.on("data", (d) => serverErr.push(d.toString()));

/** @param {string} path @param {{ method?: string, token?: string, body?: unknown }} [o] */
const api = async (path, { method = "GET", token, body } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: /** @type {any} */ (await res.json().catch(() => null)) };
};
const login = async (/** @type {string} */ email) => (await api("/api/auth/dev-login", {
  method: "POST", body: { email, deviceId: "device-lifts" } })).body?.token;

const pool = new pg.Pool({ connectionString: ownerUrl() });
/** @param {string} t @param {unknown[]} [p] */
const q = async (t, p) => (await pool.query(t, p)).rows;
const grant = (/** @type {boolean} */ on) => q(
  `insert into feature_grant (key, school_id, granted, note) values ('lift_club', $1, $2, 'smoke-lifts')
   on conflict (key, school_id) do update set granted = excluded.granted`, [HIL, on]);

const POLICY = "Lifts to fixtures are arranged between families; the school facilitates and does not operate them, "
  + "and does not inspect or insure any car. A driver undertakes that she holds a licence, that the car is insured "
  + "and roadworthy, and that every boy wears a belt. If a boy is not collected, stay with him and ring the office.";

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const head    = await login("principal@example.invalid");
  const driver  = await login("parent.whitfield@example.invalid");
  const bekker  = await login("parent.bekker@example.invalid");
  const cele    = await login("parent.cele@example.invalid");
  const boy     = await login("pillay@example.invalid");
  const coach   = await login("coach@example.invalid");
  const office  = await login("registrar@example.invalid");
  const owner   = await login("owner@example.invalid");

  // An explicit day, Johannesburg time: Saturday-like, five days ahead.
  const [m] = await q(
    `insert into match (school_id, team_code, opponent, starts_at, format, overs, status)
     values ($1, '1XI', 'Smoke Lifts', ((current_date + 5)::timestamp + time '09:00') at time zone 'Africa/Johannesburg', 'T20', 20, 'scheduled')
     returning id, starts_at`, [HIL]);
  const start = new Date(m.starts_at);
  const at = (/** @type {number} */ minutes) => new Date(start.getTime() + minutes * 60_000).toISOString();
  const [jamesCard] = await q(`select id from emergency_contact where player_id = $1 and active order by priority limit 1`, [JAMES]);

  group("Two keys: the platform's grant and the principal's policy (D17)");
  let r = await api("/api/lifts/policy", { method: "POST", token: head, body: { schoolId: HIL, body: POLICY } });
  ok("with the module not granted, the principal's signature is refused", r.status === 403 && r.body?.error === "module_disabled");
  await grant(true);
  r = await api(`/api/lifts/standing?schoolId=${HIL}`, { token: driver });
  ok("granted but unsigned, nobody may drive", r.status === 200 && r.body.moduleLive === false && r.body.mayDrive === false);
  r = await api("/api/lifts/policy", { method: "POST", token: office, body: { schoolId: HIL, body: POLICY } });
  ok("the office may not sign the school's policy", r.status === 403);
  r = await api("/api/lifts/policy", { method: "POST", token: head,
    body: { schoolId: HIL, body: POLICY, requiresClearance: false, allowOneToOne: true, meetNote: "the Chapel car park" } });
  ok("the principal signs it", r.status === 200 && r.body.version === 1);
  r = await api(`/api/lifts/policy?schoolId=${HIL}`, { token: bekker });
  ok("a parent reads the school's text in full, live", r.status === 200 && r.body.policy?.body === POLICY && r.body.policy.live === true);

  group("The driver's declaration (rule 2)");
  r = await api(`/api/lifts/standing?schoolId=${HIL}`, { token: driver });
  ok("before declaring, her standing says so in the school's words",
     r.body.mayDrive === false && r.body.reason === "no_declaration" && /declaration/.test(r.body.words ?? ""));
  r = await api("/api/lifts/declaration", { method: "POST", token: driver,
    body: { schoolId: HIL, vehicle: "silver Toyota Fortuner", registration: "nd 123-456", seats: 3,
            licenceHeld: true, insured: true, roadworthy: true, belts: true, codeAcknowledged: false, contactId: jamesCard.id } });
  ok("a declaration without the code read is refused", r.status === 422 && r.body.error === "declaration_incomplete");
  r = await api("/api/lifts/declaration", { method: "POST", token: driver,
    body: { schoolId: HIL, vehicle: "silver Toyota Fortuner", registration: "nd 123-456", seats: 3,
            licenceHeld: true, insured: true, roadworthy: true, belts: true, codeAcknowledged: true, contactId: jamesCard.id } });
  ok("she declares", r.status === 200 && Boolean(r.body.expiresOn));
  r = await api(`/api/lifts/standing?schoolId=${HIL}`, { token: driver });
  ok("...and may drive, with the car as she declared it",
     r.body.mayDrive === true && r.body.declaration?.registration === "ND 123 456" && r.body.declaration.policyCurrent === true);
  r = await api("/api/lifts/declaration", { method: "POST", token: boy,
    body: { schoolId: HIL, vehicle: "white Polo", registration: "NP 1", seats: 3, licenceHeld: true, insured: true,
            roadworthy: true, belts: true, codeAcknowledged: true } });
  ok("a pupil does not drive (Kameel, 2026-10-01)", r.status === 422 && r.body.error === "pupil_excluded");

  group("A round trip is one act (D1)");
  const before = (await q(`select count(*)::int n from lift_offer where match_id = $1`, [m.id]))[0].n;
  r = await api(`/api/matches/${m.id}/lifts`, { method: "POST", token: driver, body: { legs: [
    { leg: "out", seats: 3, meetKind: "school", meetAt: at(-105), note: "leaving sharp" },
    { leg: "back", seats: 3, meetKind: "ground", meetAt: at(-30) }] } });
  ok("a round trip whose way home meets before the start is refused, in words", r.status === 422 && r.body.error === "meet_before_start");
  ok("...and leaves no way there behind it",
     (await q(`select count(*)::int n from lift_offer where match_id = $1`, [m.id]))[0].n === before);
  r = await api(`/api/matches/${m.id}/lifts`, { method: "POST", token: driver, body: { legs: [
    { leg: "out", seats: 3, meetKind: "school", meetAt: at(-105), note: "leaving sharp" },
    { leg: "back", seats: 3, meetKind: "ground", meetAt: at(300) }] } });
  ok("the round trip is two offers", r.status === 200 && r.body.offers?.length === 2);
  const OUT = r.body.offers?.find((/** @type {any} */ o) => o.leg === "out")?.id;
  const BACK = r.body.offers?.find((/** @type {any} */ o) => o.leg === "back")?.id;
  r = await api(`/api/matches/${m.id}/lifts`, { method: "POST", token: coach, body: { legs: [{ leg: "out", seats: 1, meetKind: "ground", meetAt: at(-60) }] } });
  ok("the coach offers no lift", r.status >= 400);

  group("A family sees the offers on its son's side, and asks (rule 1)");
  r = await api(`/api/matches/${m.id}/lifts`, { token: bekker });
  const outRow = r.body?.rows?.find((/** @type {any} */ o) => o.id === OUT);
  ok("Bekker's mother reads both legs, with the driver's name, the place and the seats left",
     r.status === 200 && r.body.rows.length === 2 && outRow?.driverName === "H Whitfield"
     && outRow.meetPlace === "At school: the Chapel car park" && outRow.seatsLeft === 3);
  ok("...and never the other passengers' names (D6)", !JSON.stringify(r.body).includes("Cele"));
  for (const [who, t] of /** @type {const} */ ([["the coach", coach], ["the office", office], ["the owner's key", owner], ["the pupil", boy]])) {
    r = await api(`/api/matches/${m.id}/lifts`, { token: t });
    // The owner's key belongs to no school, so the module gate answers first.
    ok(`${who} reads no family's offers (${r.status})`,
       (r.status === 200 && r.body.rows.length === 0) || (r.status === 403 && r.body?.error === "module_disabled"));
  }
  r = await api(`/api/lifts/${OUT}/seats`, { method: "POST", token: bekker, body: { playerId: JAMES } });
  ok("a parent cannot ask for another family's son", r.status === 403);
  r = await api(`/api/lifts/${OUT}/seats`, { method: "POST", token: bekker, body: { playerId: BEKKER } });
  const S_BEKKER = r.body?.seatId;
  ok("she asks for her own", r.status === 200 && Boolean(S_BEKKER));
  // Consent to processing, granted, before any lift (Kameel, 2026-10-01).
  r = await api(`/api/lifts/${OUT}/seats`, { method: "POST", token: cele, body: { playerId: CELE } });
  ok("Cele's mother, her consent to processing not recorded, is refused", r.status === 422 && r.body.error === "consent_not_granted");
  r = await api(`/api/lifts/standing?schoolId=${HIL}`, { token: cele });
  ok("...and her standing line says why, in plain words",
     r.body.reason === "consent_not_granted" && /consent to the processing/.test(r.body.words ?? ""));
  const [celeMum] = await q(`select id from app_user where email = 'parent.cele@example.invalid'`);
  r = await api(`/api/players/${CELE}/guardians/consent`, { method: "POST", token: office,
    body: { guardianId: celeMum.id, consentVersion: "popia-2026-01" } });
  ok("the office records her consent", r.status === 200);
  r = await api(`/api/lifts/${OUT}/seats`, { method: "POST", token: cele, body: { playerId: CELE } });
  const S_CELE = r.body?.seatId;
  ok("...and now she asks for her son", r.status === 200 && Boolean(S_CELE));
  r = await api(`/api/lifts/${OUT}/seats`, { method: "POST", token: boy, body: { playerId: PILLAY } });
  ok("a pupil of sixteen may not ask for himself", r.status === 422 && r.body.error === "not_yet_eighteen");
  r = await api(`/api/lifts/standing?schoolId=${HIL}`, { token: boy });
  ok("...and is told a pupil does not drive", r.body.reason === "pupil_excluded" && /does not drive/.test(r.body.words ?? ""));
  r = await api(`/api/lifts/${BACK}/seats`, { method: "POST", token: bekker, body: { playerId: BEKKER } });
  const S_BACK = r.body?.seatId;
  r = await api(`/api/lifts/${OUT}/seats`, { method: "POST", token: bekker, body: { playerId: BEKKER } });
  ok("asking twice for one leg is refused, naming the lift he is on",
     r.status === 409 && r.body.error === "already_on_a_lift" && r.body.detail?.otherOffer === OUT);

  group("The driver accepts; names reach her and the confirmed families, logged");
  r = await api(`/api/lifts/${OUT}/passengers`, { token: driver });
  ok("the driver reads her requests by name (a request is a name)",
     r.status === 200 && r.body.rows.map((/** @type {any} */ x) => x.name).sort().join() === "M Cele,T Bekker");
  r = await api(`/api/lifts/${OUT}/passengers`, { token: bekker });
  ok("a family not yet confirmed reads nobody", r.status === 200 && r.body.rows.length === 0);
  r = await api(`/api/lifts/${OUT}/accept`, { method: "POST", token: cele, body: { seatIds: [S_CELE] } });
  ok("a family cannot accept its own request", r.status === 403);
  r = await api(`/api/lifts/${OUT}/accept`, { method: "POST", token: driver, body: { seatIds: [S_BEKKER, S_CELE] } });
  ok("the driver accepts both together", r.status === 200 && r.body.confirmed === 2);
  r = await api(`/api/matches/${m.id}/lifts`, { token: bekker });
  ok("Bekker's mother reads her son's seat as confirmed",
     r.body.rows.find((/** @type {any} */ o) => o.id === OUT)?.mySeats?.[0]?.status === "confirmed");
  r = await api(`/api/lifts/${OUT}/passengers`, { token: bekker });
  ok("...and, confirmed, the other passengers (D6)",
     r.body.rows.map((/** @type {any} */ x) => x.name).sort().join() === "M Cele,T Bekker");
  r = await api(`/api/lifts/${OUT}/passengers`, { token: coach });
  ok("the side's coach reads who is arriving by lift (§1.6)", r.body.rows.length === 2);
  r = await api(`/api/lifts/${BACK}/passengers`, { token: coach });
  ok("...and nothing of the way home", r.body.rows.length === 0);
  const logged = await q(`select resource, count(*)::int n from access_log where $1 = any(record_ids) and resource like 'lift_%' group by resource`, [OUT]);
  // The driver, the confirmed family and the coach; not the refusals.
  ok("every names read is on the access log, and no refusal is", logged.find((x) => x.resource === "lift_passengers")?.n === 3);
  r = await api(`/api/lifts/${OUT}/contacts`, { token: driver });
  ok("five days out, nobody's number is given", r.status === 200 && r.body.contacts === null);

  group("The office's counts, and no names (D10)");
  r = await api(`/api/matches/${m.id}/lifts/summary`, { token: office });
  const outCount = r.body?.rows?.find((/** @type {any} */ x) => x.leg === "out");
  ok("the office reads the counts per leg", r.status === 200 && outCount?.offers === 1 && outCount.confirmed === 2 && outCount.seatsOffered === 3);
  ok("...and nothing in them names anybody", !/Bekker|Cele|Whitfield/.test(JSON.stringify(r.body)));
  r = await api(`/api/lifts/${OUT}/passengers`, { token: office });
  ok("the office reads no passenger list", r.body.rows.length === 0);
  r = await api(`/api/matches/${m.id}/lifts/summary`, { token: driver });
  ok("a parent reads no counts", r.body.rows.length === 0);

  group("The fixture moves: driver first, then the family (§1.5)");
  await q(`update match set starts_at = starts_at + interval '1 day' where id = $1`, [m.id]);
  r = await api(`/api/matches/${m.id}/lifts`, { token: bekker });
  let row = r.body.rows.find((/** @type {any} */ o) => o.id === OUT);
  ok("the lift reads as waiting on its driver, and so does his seat",
     row?.awaitingDriver === true && row.mySeats[0]?.status === "awaiting_driver");
  r = await api(`/api/lift-seats/${S_BEKKER}/reconfirm`, { method: "POST", token: bekker });
  ok("the family cannot say yes before the driver has", r.status === 422 && r.body.error === "awaiting_driver");
  r = await api(`/api/lifts/${OUT}/reaffirm`, { method: "POST", token: driver, body: { version: 1 } });
  ok("a reaffirm against the version she read before the move is a conflict", r.status === 409);
  r = await api(`/api/lifts/${OUT}/reaffirm`, { method: "POST", token: driver, body: { version: row?.version } });
  ok("the driver still offers it", r.status === 200);
  r = await api(`/api/matches/${m.id}/lifts`, { token: bekker });
  row = r.body.rows.find((/** @type {any} */ o) => o.id === OUT);
  ok("...and now the seat waits on the family", row?.awaitingDriver === false && row.mySeats[0]?.status === "awaiting_guardian");
  r = await api(`/api/lift-seats/${S_BEKKER}/reconfirm`, { method: "POST", token: bekker });
  ok("Bekker's mother says yes again", r.status === 200);
  r = await api(`/api/matches/${m.id}/lifts`, { token: bekker });
  ok("...and it is confirmed", r.body.rows.find((/** @type {any} */ o) => o.id === OUT)?.mySeats[0]?.status === "confirmed");
  const [notices] = await q(
    `select count(*) filter (where recipient_id = (select id from app_user where email = 'parent.whitfield@example.invalid')
                               and title like 'A fixture has moved%')::int moved,
            count(*) filter (where title like 'A lift has changed%')::int asked,
            count(*) filter (where position('Bekker' in body) > 0 or position('Cele' in body) > 0
                               or position('Whitfield' in body) > 0)::int named
       from notification where kind = 'lift' and subject_id = $1`, [m.id]);
  ok("the driver was asked about each leg, the families after her, and no notice names anybody",
     notices.moved === 2 && notices.asked >= 2 && notices.named === 0);

  group("A family's no is never switched off (rule 1, D13)");
  await grant(false);
  r = await api(`/api/lifts/${BACK}/seats`, { method: "POST", token: cele, body: { playerId: CELE } });
  ok("with the module taken back, a new request is refused", r.status === 403 && r.body.error === "module_disabled");
  r = await api(`/api/lift-seats/${S_BACK}/withdraw`, { method: "POST", token: bekker });
  ok("...and a withdrawal still goes through", r.status === 200);
  await grant(true);
  ok("...and the seat is withdrawn", (await q(`select state from lift_seat where id = $1`, [S_BACK]))[0]?.state === "withdrawn");

  group("A pupil of eighteen still at school asks for himself (Kameel's follow-up, 2026-10-01)");
  const [{ born: pillayBorn }] = await q(`select born::text from player where id = $1`, [PILLAY]);
  await q(`update player set born = (current_date - interval '18 years' - interval '30 days')::date where id = $1`, [PILLAY]);
  // Tomorrow at two, Johannesburg time: inside the day window for numbers.
  const [m2] = await q(
    `insert into match (school_id, team_code, opponent, starts_at, format, overs, status)
     values ($1, '1XI', 'Smoke Lifts 18', ((current_date + 1)::timestamp + time '14:00') at time zone 'Africa/Johannesburg', 'T20', 20, 'scheduled')
     returning id, starts_at`, [HIL]);
  r = await api(`/api/matches/${m2.id}/lifts`, { method: "POST", token: driver, body: { legs: [
    { leg: "out", seats: 2, meetKind: "school", meetAt: new Date(new Date(m2.starts_at).getTime() - 60 * 60_000).toISOString() }] } });
  const ADULT_OUT = r.body?.offers?.[0]?.id;
  ok("the driver offers a lift to it", r.status === 200 && Boolean(ADULT_OUT));
  r = await api(`/api/matches/${m2.id}/lifts`, { token: boy });
  let mine = r.body?.rows?.[0];
  ok("Pillay, eighteen, reads the lift on his own side: place and time, no driver's name yet, himself the only boy",
     r.status === 200 && r.body.rows.length === 1 && mine?.driverName == null && Boolean(mine?.meetAt)
     && mine?.myChildren?.length === 1 && mine.myChildren[0].playerId === PILLAY && mine.myChildren[0].how === "self");
  r = await api(`/api/lifts/${ADULT_OUT}/seats`, { method: "POST", token: boy, body: { playerId: CELE } });
  ok("...he may not ask for anybody else", r.status === 422 && r.body.error === "pupil_excluded");
  r = await api(`/api/lifts/${ADULT_OUT}/seats`, { method: "POST", token: boy, body: { playerId: PILLAY } });
  const S_PILLAY = r.body?.seatId;
  ok("...he asks for himself", r.status === 200 && Boolean(S_PILLAY));
  const [seatRow] = await q(`select consent_by, guardian_link_id, requested_by = (select id from app_user where email = 'pillay@example.invalid') as his
                               from lift_seat where id = $1`, [S_PILLAY]);
  ok("...and the seat names him as the one who consented", seatRow?.consent_by === "self" && seatRow.guardian_link_id === null && seatRow.his === true);
  r = await api(`/api/lifts/${ADULT_OUT}/passengers`, { token: boy });
  ok("...he reads no passenger list", r.status === 200 && r.body.rows.length === 0);
  r = await api(`/api/matches/${m2.id}/lifts/summary`, { token: boy });
  ok("...and no counts", r.status === 200 && r.body.rows.length === 0);
  r = await api(`/api/lifts/${ADULT_OUT}/contacts`, { token: boy });
  ok("...and no number while his seat is only asked for", r.status === 200 && r.body.contacts === null);
  r = await api(`/api/lifts/${ADULT_OUT}/accept`, { method: "POST", token: driver, body: { seatIds: [S_PILLAY] } });
  ok("the driver confirms him", r.status === 200 && r.body.confirmed === 1);
  r = await api(`/api/matches/${m2.id}/lifts`, { token: boy });
  mine = r.body?.rows?.[0];
  ok("confirmed, he reads the driver's name and his seat", mine?.driverName === "H Whitfield" && mine.mySeats?.[0]?.status === "confirmed");
  const [driverCard] = await q(`select phone from emergency_contact where id = $1`, [jamesCard.id]);
  r = await api(`/api/lifts/${ADULT_OUT}/contacts`, { token: boy });
  ok("...and, on the day, her number as a guardian would", r.status === 200 && r.body.contacts?.as === "guardian"
     && r.body.contacts.driver?.phone === driverCard.phone && r.body.contacts.passengers === undefined);
  const [{ n: boyReads }] = await q(`select count(*)::int n from access_log where resource = 'lift_contacts' and $1 = any(record_ids)
                                       and person_id = (select id from app_user where email = 'pillay@example.invalid')`, [ADULT_OUT]);
  ok("...logged the same way", boyReads === 1);
  const [told] = await q(`select count(*) filter (where kind = 'system')::int sys, count(*)::int n,
                                 count(*) filter (where position('Pillay' in body) > 0 or position('Whitfield' in body) > 0)::int named
                            from notification where subject_id = $1 and subject_person_id = $2
                             and recipient_id = (select id from app_user where email = 'pillay@example.invalid')`, [m2.id, PILLAY]);
  ok("...told his seat is confirmed, as the system's notice, naming nobody", told.sys === 1 && told.n === 1 && told.named === 0);
  r = await api(`/api/lift-seats/${S_PILLAY}/withdraw`, { method: "POST", token: boy });
  ok("he withdraws his own seat", r.status === 200
     && (await q(`select state from lift_seat where id = $1`, [S_PILLAY]))[0]?.state === "withdrawn");
  await q(`update player set born = $2::date where id = $1`, [PILLAY, pillayBorn]);
  r = await api(`/api/lifts/${ADULT_OUT}/seats`, { method: "POST", token: boy, body: { playerId: PILLAY } });
  ok("at sixteen again, he is refused", r.status === 422 && r.body.error === "not_yet_eighteen");
  r = await api(`/api/matches/${m2.id}/lifts`, { token: boy });
  ok("...and reads no lift", r.status === 200 && r.body.rows.length === 0);

  // ── Phase 2: the day (db/76) ─────────────────────────────────────
  group("The day: the driver's marks, the receivers, the office and the watch (phase 2, db/76)");
  const u14 = await login("u14coach@example.invalid");
  // Tomorrow at ten, Johannesburg time: inside the day window.
  const [m3] = await q(
    `insert into match (school_id, team_code, opponent, starts_at, format, overs, status)
     values ($1, '1XI', 'Smoke Lifts Day', ((current_date + 1)::timestamp + time '10:00') at time zone 'Africa/Johannesburg', 'T20', 20, 'scheduled')
     returning id, starts_at`, [HIL]);
  const s3 = new Date(m3.starts_at).getTime();
  r = await api(`/api/matches/${m3.id}/lifts`, { method: "POST", token: driver, body: { legs: [
    { leg: "out", seats: 3, meetKind: "school", meetAt: new Date(s3 - 90 * 60_000).toISOString() },
    { leg: "back", seats: 3, meetKind: "ground", meetAt: new Date(s3 + 300 * 60_000).toISOString() }] } });
  const DOUT = r.body?.offers?.find((/** @type {any} */ o) => o.leg === "out")?.id;
  const DBACK = r.body?.offers?.find((/** @type {any} */ o) => o.leg === "back")?.id;
  ok("the driver offers both ways to tomorrow's fixture", r.status === 200 && Boolean(DOUT && DBACK));
  /** @type {Record<string, string>} */
  const seat = {};
  for (const [leg, o] of /** @type {const} */ ([["out", DOUT], ["back", DBACK]])) {
    seat[`bekker-${leg}`] = (await api(`/api/lifts/${o}/seats`, { method: "POST", token: bekker, body: { playerId: BEKKER } })).body?.seatId;
    seat[`cele-${leg}`] = (await api(`/api/lifts/${o}/seats`, { method: "POST", token: cele, body: { playerId: CELE } })).body?.seatId;
    r = await api(`/api/lifts/${o}/accept`, { method: "POST", token: driver, body: { seatIds: [seat[`bekker-${leg}`], seat[`cele-${leg}`]] } });
    ok(`...and confirms both boys on the way ${leg === "out" ? "there" : "home"}`, r.status === 200 && r.body.confirmed === 2);
  }

  r = await api(`/api/matches/${m3.id}/lifts/day`, { token: driver });
  ok("the driver's day cards name her passengers", r.status === 200 && r.body.rows.length === 2
     && r.body.rows.every((/** @type {any} */ e) => e.as === "driver" && e.seats.map((/** @type {any} */ s) => s.name).sort().join() === "M Cele,T Bekker"));
  r = await api(`/api/matches/${m3.id}/lifts/day`, { token: bekker });
  ok("Bekker's mother's day cards carry her son and nobody else's",
     r.status === 200 && r.body.rows.length === 2 && r.body.rows[0].driverName === "H Whitfield" && !JSON.stringify(r.body).includes("Cele"));
  r = await api(`/api/matches/${m3.id}/lifts/day`, { token: coach });
  ok("the coach has no day card of his own", r.status === 200 && r.body.rows.length === 0);

  for (const [who, t] of /** @type {const} */ ([["a parent on the lift", bekker], ["the coach", coach], ["the office", office]])) {
    r = await api(`/api/lifts/${DOUT}/mark`, { method: "POST", token: t, body: { event: "departed" } });
    ok(`${who} cannot mark the lift as left`, r.status === 403);
  }
  r = await api(`/api/lift-seats/${seat["bekker-out"]}/mark`, { method: "POST", token: driver, body: { event: "boarded" } });
  ok("the driver marks T Bekker in the car", r.status === 200);
  r = await api(`/api/lift-seats/${seat["bekker-out"]}/mark`, { method: "POST", token: driver, body: { event: "boarded" } });
  ok("...once (marks go forward only)", r.status === 409 && r.body.error === "already_marked");
  r = await api(`/api/lifts/${DOUT}/cancel`, { method: "POST", token: driver });
  ok("a lift with a boy in it is not cancelled", r.status === 422 && r.body.error === "on_the_road");
  await api(`/api/lift-seats/${seat["cele-out"]}/mark`, { method: "POST", token: driver, body: { event: "boarded" } });
  r = await api(`/api/lifts/${DOUT}/mark`, { method: "POST", token: driver, body: { event: "departed" } });
  ok("she marks the lift as left", r.status === 200);
  r = await api(`/api/lifts/${DOUT}/mark`, { method: "POST", token: driver, body: { event: "departed" } });
  ok("...and a second 'left' is refused", r.status === 409 && r.body.error === "already_departed");
  r = await api(`/api/lift-seats/${seat["bekker-out"]}/mark`, { method: "POST", token: driver, body: { event: "handed_over" } });
  ok("she hands T Bekker over at the ground", r.status === 200);

  r = await api(`/api/matches/${m3.id}/lifts/expected`, { token: coach });
  ok("the 1XI's coach reads who is arriving by lift, with the marks",
     r.status === 200 && r.body.rows.map((/** @type {any} */ x) => x.name).sort().join() === "M Cele,T Bekker"
     && Boolean(r.body.rows.find((/** @type {any} */ x) => x.name === "T Bekker")?.handedOverAt));
  for (const [who, t] of /** @type {const} */ ([["the U14A's coach", u14], ["a parent", bekker], ["the office", office]])) {
    r = await api(`/api/matches/${m3.id}/lifts/expected`, { token: t });
    ok(`${who} reads no expected list`, r.status === 200 && r.body.rows.length === 0);
  }
  for (const [who, t] of /** @type {const} */ ([["his mother (not at the ground)", bekker], ["the U14A's coach", u14]])) {
    r = await api(`/api/lift-seats/${seat["bekker-out"]}/receive`, { method: "POST", token: t });
    ok(`${who} cannot say "with us"`, r.status === 403);
  }
  r = await api(`/api/lift-seats/${seat["bekker-out"]}/receive`, { method: "POST", token: coach });
  ok("the coach says \"with us\"", r.status === 200);
  r = await api(`/api/lifts/${DOUT}/mark`, { method: "POST", token: driver, body: { event: "arrived" } });
  const [afterArrive] = await q(`select state from lift_offer where id = $1`, [DOUT]);
  ok("she arrives; M Cele, in the car and not handed over, keeps the lift short of done",
     r.status === 200 && afterArrive.state === "closed");
  r = await api(`/api/lifts/exceptions?schoolId=${HIL}&matchId=${m3.id}`, { token: office });
  ok("the office reads the exception by name", r.status === 200
     && r.body.rows.map((/** @type {any} */ x) => `${x.name}:${x.kind}`).join() === "M Cele:not_handed_over");
  for (const [who, t] of /** @type {const} */ ([["the driver", driver], ["the coach", coach], ["the principal", head]])) {
    r = await api(`/api/lifts/exceptions?schoolId=${HIL}`, { token: t });
    ok(`${who} reads no exceptions`, r.status === 200 && r.body.rows.length === 0);
  }
  await api(`/api/lift-seats/${seat["cele-out"]}/receive`, { method: "POST", token: coach });
  ok("the coach has M Cele too, and the lift is done",
     (await q(`select state from lift_offer where id = $1`, [DOUT]))[0]?.state === "done");

  // The way home: an hour past its meeting time, as the clock would have it.
  await q(`update lift_offer set meet_at = now() - interval '1 hour' where id = $1`, [DBACK]);
  r = await api("/api/lifts/watch", { method: "POST", token: driver });
  ok("only the platform's key runs the watch", r.status === 403);
  r = await api("/api/lifts/watch", { method: "POST", token: owner });
  const [watched] = await q(`select count(*) filter (where title = 'A lift has not been marked as leaving')::int fam,
                                    count(*) filter (where title = 'Has your lift left?')::int drv
                               from notification where subject_id = $1`, [m3.id]);
  ok("the watch tells each family and the driver, once", r.status === 200 && r.body.notLeft >= 2 && watched.fam === 2 && watched.drv === 1);
  await api("/api/lifts/watch", { method: "POST", token: owner });
  const [again] = await q(`select count(*)::int n from notification where subject_id = $1 and title = 'A lift has not been marked as leaving'`, [m3.id]);
  ok("...and a second run tells nobody again", again.n === 2);
  for (const k of ["bekker-back", "cele-back"]) await api(`/api/lift-seats/${seat[k]}/mark`, { method: "POST", token: driver, body: { event: "boarded" } });
  await api(`/api/lifts/${DBACK}/mark`, { method: "POST", token: driver, body: { event: "departed" } });
  await api(`/api/lift-seats/${seat["bekker-back"]}/mark`, { method: "POST", token: driver, body: { event: "handed_over" } });
  r = await api(`/api/lift-seats/${seat["cele-back"]}/mark`, { method: "POST", token: driver, body: { event: "not_collected" } });
  const [nc] = await q(`select count(*) filter (where recipient_id = (select id from app_user where email = 'parent.cele@example.invalid'))::int mum,
                               count(*) filter (where recipient_id = (select id from app_user where email = 'registrar@example.invalid'))::int office,
                               count(*) filter (where position('Cele' in body) > 0)::int named
                          from notification where subject_id = $1 and title in ('He was not collected from his lift', 'A boy was not collected from a lift')`, [m3.id]);
  ok("M Cele not collected: his mother and the office are told, naming nobody", r.status === 200 && nc.mum === 1 && nc.office === 1 && nc.named === 0);
  r = await api(`/api/lift-seats/${seat["bekker-back"]}/receive`, { method: "POST", token: coach });
  ok("the coach does not receive a boy at home", r.status === 403);
  r = await api(`/api/lift-seats/${seat["bekker-back"]}/receive`, { method: "POST", token: bekker });
  ok("his mother confirms she has T Bekker", r.status === 200);
  r = await api(`/api/lift-seats/${seat["cele-back"]}/resolve`, { method: "POST", token: bekker, body: { resolution: "school_office" } });
  ok("a parent does not resolve an exception", r.status === 403);
  r = await api(`/api/lift-seats/${seat["cele-back"]}/resolve`, { method: "POST", token: office, body: { resolution: "school_office" } });
  ok("the office resolves M Cele: collected at the school office", r.status === 200);
  r = await api(`/api/lifts/${DBACK}/mark`, { method: "POST", token: driver, body: { event: "arrived" } });
  ok("she arrives home and the lift is done", r.status === 200 && (await q(`select state from lift_offer where id = $1`, [DBACK]))[0]?.state === "done");
  const [logs] = await q(`select count(*) filter (where resource = 'lift_exceptions')::int exc, count(*) filter (where resource = 'lift_expected')::int exp,
                                 count(*) filter (where resource = 'lift_day')::int dayc
                            from access_log where $1 = any(record_ids)`, [DOUT]);
  ok("the names read on the day are on the access log", logs.exc >= 1 && logs.exp === 1 && logs.dayc >= 1);
  r = await api("/api/lifts/mine", { token: boy });
  ok("a pupil of sixteen reads no lift as his own", r.status === 200 && r.body.rows.length === 0);

  group("The purge: three years after the fixture, by the office, leaving counts (§5.3)");
  const [old] = await q(
    `insert into match (school_id, team_code, opponent, starts_at, format, overs, status)
     values ($1, '1XI', 'Smoke Lifts Long Ago', ((current_date - interval '3 years' - interval '10 days')::date::timestamp + time '09:00') at time zone 'Africa/Johannesburg', 'T20', 20, 'complete')
     returning id, starts_at`, [HIL]);
  const [oldOffer] = await q(
    `insert into lift_offer (school_id, match_id, team_code, leg, driver_id, declaration_id, seats, meet_kind, meet_at, fixture_starts_at)
     select $1, $2, '1XI', 'out', d.person_id, d.id, 2, 'school', $3::timestamptz - interval '90 minutes', $3
       from lift_driver_declaration d join app_user u on u.id = d.person_id
      where u.email = 'parent.whitfield@example.invalid' order by d.declared_at desc limit 1
     returning id`, [HIL, old.id, old.starts_at]);
  await q(`insert into lift_seat (offer_id, school_id, match_id, team_code, leg, player_id, consent_by, guardian_assignment_id, guardian_link_id,
                                  requested_by, guardian_ok_version, driver_ok_version, state)
           select $1, null, null, null, null, $2, 'guardian', g.assignment_id, g.id, a.person_id, 1, 1, 'confirmed'
             from assignment_subject g join role_assignment a on a.id = g.assignment_id join app_user u on u.id = a.person_id
            where g.player_id = $2 and u.email = 'parent.bekker@example.invalid' limit 1`, [oldOffer.id, BEKKER]);
  r = await api(`/api/lifts/purge?schoolId=${HIL}`, { token: office });
  ok("the office's due list holds the lift of three years ago, naming nobody",
     r.status === 200 && r.body.rows.some((/** @type {any} */ x) => x.id === oldOffer.id && x.seats === 1) && !/Bekker|Whitfield/.test(JSON.stringify(r.body)));
  r = await api(`/api/lifts/purge?schoolId=${HIL}`, { token: bekker });
  ok("a parent reads no due list", r.status === 200 && r.body.rows.length === 0);
  r = await api(`/api/lifts/${DOUT}/purge`, { method: "POST", token: office });
  ok("tomorrow's lift is not due", r.status === 422 && r.body.error === "not_due");
  r = await api(`/api/lifts/${oldOffer.id}/purge`, { method: "POST", token: owner });
  ok("the owner's key purges nothing", r.status === 403);
  r = await api(`/api/lifts/${oldOffer.id}/purge`, { method: "POST", token: office });
  const [gone] = await q(`select (select count(*) from lift_offer where id = $1)::int o, (select count(*) from lift_seat where offer_id = $1)::int s`, [oldOffer.id]);
  const [logRow] = await q(`select offers, seats from lift_purge_log where school_id = $1 and season = to_char(($2::timestamptz at time zone 'Africa/Johannesburg'), 'YYYY')`,
    [HIL, old.starts_at]);
  ok("the office purges it: the lift and its seat are gone, a row of counts remains",
     r.status === 200 && gone.o === 0 && gone.s === 0 && logRow?.offers === 1 && logRow.seats === 1);
  const [named] = await q(`select count(*)::int n from notification where subject_id = $1 and kind = 'lift'
                             and (position('Bekker' in body) > 0 or position('Cele' in body) > 0 or position('Whitfield' in body) > 0)`, [m3.id]);
  ok("no notice on the day names anybody", named.n === 0);

  group("The principal withdraws the policy: every open lift is cancelled");
  r = await api("/api/lifts/policy/withdraw", { method: "POST", token: head, body: { schoolId: HIL } });
  ok("withdrawn", r.status === 200 && r.body.cancelled === 3);
  const states = await q(`select state, cancel_kind from lift_offer where match_id = $1 order by leg`, [m.id]);
  ok("...both legs cancelled 'policy_withdrawn'",
     states.length === 2 && states.every((x) => x.state === "cancelled" && x.cancel_kind === "policy_withdrawn"));
  r = await api(`/api/lifts/standing?schoolId=${HIL}`, { token: driver });
  ok("...and nobody may drive", r.body.moduleLive === false && r.body.reason === "no_policy");
} catch (e) {
  fail++;
  console.log("  ✗ the walk threw:", e);
} finally {
  await grant(false).catch(() => {});
  await pool.end();
  server.kill();
}

if (serverErr.join("").match(/Error|error:/)) console.log(serverErr.join("").slice(0, 2000));
console.log("\n" + "─".repeat(52));
console.log(`LIFTS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

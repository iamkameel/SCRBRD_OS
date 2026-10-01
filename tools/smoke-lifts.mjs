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

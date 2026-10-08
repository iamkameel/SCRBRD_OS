#!/usr/bin/env node
/**
 * The parent's action list, slice A1, through the API (GA-I20;
 * docs/design/GA-I20_parent_action_list.md §5, §7 A1).
 *
 * The list on a parent's Home is drawn from reads the family app makes. This
 * walks each of them as the people who make them, with the seed's invented
 * families, and holds every one to its own child and to its own reader:
 *
 *   1. my_children carries the version and time of her OWN link's terms (R8a);
 *      a pending consent carries neither; an ended link, a pupil, a coach and
 *      the office get no child.
 *   2. emergency_contact_count (N2) is a count and never a contact: her own
 *      child's live numbers, counted, and the count follows a number retired
 *      and added; another family's child, a pupil and an ended link get no row,
 *      never a zero; and the read writes nothing to the access log, where the
 *      contacts read itself does.
 *   3. The public-name answer (N5) carries the wording's version and the time
 *      it was recorded, to the giver; the office's list is as it was.
 *   4. /api/lifts/requests-mine (N3) counts the requests on the lifts she
 *      drives, under db/70's own policies, and returns no name and no child;
 *      the seat states the list reads (requested, awaiting_driver,
 *      awaiting_guardian, confirmed) arrive at the family they belong to and
 *      at nobody else; switched off, it says module_disabled.
 *   5. Two children at two schools: each read answers per child and nothing
 *      across; a reader at the other school reads nothing of a Hilton fixture.
 *   6. A stranger whose request is pending reads her own request and no child;
 *      a parent whose link has ended reads no child and may not declare.
 *   7. Everything a parent's list reads, as one body: her own child's counts
 *      and no other child's name, no phone, no email.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-family-todo.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";

const PORT = port(5494);
const BASE = `http://127.0.0.1:${PORT}`;
const HIL = "11111111-1111-1111-1111-111111111111";
const WES = "22222222-2222-2222-2222-222222222222";
const JAMES = "aaaaaaaa-0000-0000-0000-000000000001";   // James Whitfield, 1XI: the driver's son
const BEKKER = "aaaaaaaa-0000-0000-0000-000000000002";  // T Bekker, 1XI
const NAIDOO = "aaaaaaaa-0000-0000-0000-000000000003";  // S Naidoo: his parent's link has ended
const CELE = "aaaaaaaa-0000-0000-0000-000000000004";    // M Cele: his parent's consent is pending
const PILLAY = "aaaaaaaa-0000-0000-0000-000000000005";  // R Pillay: parent@example.invalid's son, and a pupil with his own account
const KD = "aaaaaaaa-0000-0000-0000-000000000006";      // K Dlamini, Hilton U16B: Sarah's
const DM = "bbbbbbbb-0000-0000-0000-000000000001";      // D Mkhize, Westville 1XI: Sarah's
const OTHER_NAMES = /Bekker|Whitfield|Naidoo|Cele|Dlamini|Mkhize/;
const PHONE = /\+?\d{2,3}[ -]?\d{2,3}[ -]?\d{3}[ -]?\d{3,4}|"phone|"email|"phone_alt/;

let pass = 0, fail = 0;
const ok = (/** @type {string} */ n, /** @type {unknown} */ c, /** @type {unknown} */ d = undefined) => {
  if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${JSON.stringify(d).slice(0, 300)}`); }
};
const group = (/** @type {string} */ t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-family-todo-secret" },
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
  method: "POST", body: { email, deviceId: "device-family-todo" } })).body?.token;
const read = async (/** @type {string} */ resource, /** @type {string} */ token, /** @type {string} */ qs = "") =>
  api(`/api/read/${resource}${qs}`, { token });
const count = async (/** @type {string} */ token, /** @type {string} */ playerId) =>
  (await read("emergency_contact_count", token, `?playerId=${playerId}`)).body?.rows ?? null;

const pool = new pg.Pool({ connectionString: ownerUrl() });
/** @param {string} t @param {unknown[]} [p] */
const q = async (t, p) => (await pool.query(t, p)).rows;
const grant = (/** @type {boolean} */ on) => q(
  `insert into feature_grant (key, school_id, granted, note) values ('lift_club', $1, $2, 'smoke-family-todo')
   on conflict (key, school_id) do update set granted = excluded.granted`, [HIL, on]);
const logRows = async () => (await q(`select count(*)::int n from access_log`))[0].n;

const POLICY = "Lifts to fixtures are arranged between families; the school facilitates and does not operate them, "
  + "and does not inspect or insure any car. A driver undertakes that she holds a licence, that the car is insured "
  + "and roadworthy, and that every boy wears a belt. If a boy is not collected, stay with him and ring the office.";

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const parent  = await login("parent@example.invalid");            // R Pillay's
  const bekker  = await login("parent.bekker@example.invalid");
  const driver  = await login("parent.whitfield@example.invalid");
  const cele    = await login("parent.cele@example.invalid");
  const ended   = await login("parent.naidoo@example.invalid");
  const sarah   = await login("sarah@example.invalid");
  const boy     = await login("pillay@example.invalid");
  const coach   = await login("coach@example.invalid");
  const wesCoach = await login("coach.wes@example.invalid");
  const office  = await login("registrar@example.invalid");
  const head    = await login("principal@example.invalid");
  const watcher = await login("watcher@example.invalid");
  ok("everyone signs in", [parent, bekker, driver, cele, ended, sarah, boy, coach, wesCoach, office, head, watcher].every(Boolean));

  group("1. my_children: her own links, with the version and time of her own terms (R8a)");
  {
    const rows = (await read("my_children", parent)).body?.rows ?? [];
    const [link] = await q(`select s.consent_version, s.consent_at from assignment_subject s join role_assignment a on a.id = s.assignment_id
                             where a.person_id = (select id from app_user where email = 'parent@example.invalid') and s.player_id = $1`, [PILLAY]);
    ok("R Pillay's parent: one child, his own, the version and the time her link records",
       rows.length === 1 && rows[0].player_id === PILLAY && rows[0].consent_state === "granted"
       && rows[0].consent_version === link.consent_version && link.consent_version === "popia-2026-01"
       && new Date(rows[0].consent_at).getTime() === new Date(link.consent_at).getTime(), rows);
    const s = (await read("my_children", sarah)).body?.rows ?? [];
    ok("Sarah: her two, at two schools, each with his own school's name and her own link's version",
       s.map((r) => `${r.full_name}@${r.school_name}`).sort().join() === "D Mkhize@Westville Boys' High,K Dlamini@Hilton College"
       && s.every((r) => r.consent_version === "popia-2026-01" && r.consent_at), s.map((r) => r.full_name));
    const c = (await read("my_children", cele)).body?.rows ?? [];
    ok("a link whose terms are not agreed: consent pending, and no version or time it never had (R8a's row)",
       c.length === 1 && c[0].consent_state === "pending" && c[0].consent_version === null && c[0].consent_at === null, c);
    for (const [who, t] of /** @type {const} */ ([["the parent whose link ended", ended], ["the pupil", boy], ["a coach", coach], ["the office", office]])) {
      const r = await read("my_children", t);
      ok(`${who}: no child`, r.status === 200 && r.body.rows.length === 0, r.body?.rows?.map((/** @type {any} */ x) => x.full_name));
    }
  }

  group("2. emergency_contact_count (N2): a count, never a contact, and only her own child's");
  {
    const before = await logRows();
    const mine = await count(parent, PILLAY);
    ok("her son's live numbers, counted: one row, his id, his school and a number",
       mine?.length === 1 && mine[0].player_id === PILLAY && mine[0].school_id === HIL && mine[0].active_count === 2, mine);
    ok("...the row's keys are those three and nothing else", JSON.stringify(Object.keys(mine?.[0] ?? {}).sort()) === JSON.stringify(["active_count", "player_id", "school_id"]));
    ok("...and the read wrote nothing to the access log (it disclosed no contact)", (await logRows()) === before);
    const list = (await read("emergency_contacts", parent, `?playerId=${PILLAY}`)).body?.rows ?? [];
    ok("the contacts read itself (the door on Family) is still the logged one", list.length === 2 && (await logRows()) === before + 1);
    // The count follows the record: the last number retired, and one added.
    for (const c of list) {
      const r = await api(`/api/emergency-contacts/${c.id}/retire`, { method: "POST", token: parent });
      ok(`she retires a number (${r.status})`, r.status === 200);
    }
    const none = await count(parent, PILLAY);
    ok("with every number retired: still one row, saying 0 (R9 fires), never no row", none?.length === 1 && none[0].active_count === 0, none);
    const add = await api(`/api/players/${PILLAY}/emergency-contacts`, { method: "POST", token: parent,
      body: { priority: 1, name: "D Pillay", relationship: "mother", phone: "082 555 0101" } });
    ok("she adds one", add.status === 200, add.body);
    ok("...and the count says 1 (R9 clears)", (await count(parent, PILLAY))?.[0]?.active_count === 1);
    // Refusals: no row, never a zero.
    ok("another family's child (T Bekker): no row", (await count(parent, BEKKER))?.length === 0);
    ok("the pupil asking about himself (selfaccess holds no player.emergency.read): no row", (await count(boy, PILLAY))?.length === 0);
    ok("the parent whose link has ended, about her son: no row", (await count(ended, NAIDOO))?.length === 0);
    ok("a spectator: no row", (await count(watcher, PILLAY))?.length === 0);
    const kd = await count(sarah, KD), dm = await count(sarah, DM);
    ok("Sarah: one row for each of hers, each at his own school", kd?.length === 1 && kd[0].school_id === HIL && dm?.length === 1 && dm[0].school_id === WES, [kd, dm]);
    const wes = await count(wesCoach, PILLAY);
    ok("a Westville coach asking about a Hilton boy: no row", wes?.length === 0, wes);
    const bad = await read("emergency_contact_count", parent, "");
    ok("no playerId: refused, not a list", bad.status >= 400 && bad.status < 500, bad.status);
  }

  group("3. The public-name answer (N5): the version and the time, to the one who gave it");
  {
    let r = await api(`/api/players/${PILLAY}/public-name`, { token: parent });
    ok("not answered: her own answer, with no version and no time", r.status === 200 && r.body.mine?.state === "not_answered"
       && r.body.mine.version === null && r.body.mine.recordedAt === null, r.body?.mine);
    r = await api(`/api/players/${PILLAY}/public-name`, { method: "POST", token: parent, body: { yes: true, version: "public-names-2026-10" } });
    ok("she says yes to the current wording", r.status === 200);
    r = await api(`/api/players/${PILLAY}/public-name`, { token: parent });
    const [rec] = await q(`select version, recorded_at from public_name_consent where player_id = $1 order by seq desc limit 1`, [PILLAY]);
    ok("her answer now carries the wording's version and the moment it was recorded, as the record holds them",
       r.body.mine?.state === "given" && r.body.mine.actor === "you" && r.body.mine.version === "public-names-2026-10"
       && new Date(r.body.mine.recordedAt).getTime() === new Date(rec.recorded_at).getTime(), r.body?.mine);
    r = await api(`/api/players/${PILLAY}/public-name`, { token: office });
    ok("the office's list is as it was: where each answer stands, no version, no time",
       r.status === 200 && Array.isArray(r.body.guardians) && r.body.guardians.length >= 1
       && r.body.guardians.every((/** @type {any} */ g) => !("version" in g) && !("recordedAt" in g)), r.body?.guardians);
    r = await api(`/api/players/${PILLAY}/public-name`, { token: bekker });
    ok("another family's parent: nothing (404)", r.status === 404);
    r = await api(`/api/players/${NAIDOO}/public-name`, { token: ended });
    ok("the parent whose link has ended: nothing (404)", r.status === 404);
  }

  group("4. /api/lifts/requests-mine (N3): counts on the lifts she drives, no name");
  {
    let r = await api("/api/lifts/requests-mine", { token: driver });
    ok("with the module not granted: module_disabled, which the list reads as no row", r.status === 403 && r.body?.error === "module_disabled");
    await grant(true);
    ok("the principal signs the policy", (await api("/api/lifts/policy", { method: "POST", token: head,
      body: { schoolId: HIL, body: POLICY, requiresClearance: false, allowOneToOne: true, meetNote: "the Chapel car park" } })).status === 200);
    const [card] = await q(`select id from emergency_contact where player_id = $1 and active order by priority limit 1`, [JAMES]);
    ok("H Whitfield declares", (await api("/api/lifts/declaration", { method: "POST", token: driver,
      body: { schoolId: HIL, vehicle: "silver Toyota Fortuner", registration: "nd 123-456", seats: 3, licenceHeld: true, insured: true,
              roadworthy: true, belts: true, codeAcknowledged: true, contactId: card.id } })).status === 200);
    const [m] = await q(
      `insert into match (school_id, team_code, opponent, starts_at, format, overs, status)
       values ($1, '1XI', 'Smoke Family Todo', ((current_date + 2)::timestamp + time '09:00') at time zone 'Africa/Johannesburg', 'T20', 20, 'scheduled')
       returning id, starts_at`, [HIL]);
    const meet = new Date(new Date(m.starts_at).getTime() - 90 * 60_000).toISOString();
    r = await api(`/api/matches/${m.id}/lifts`, { method: "POST", token: driver, body: { legs: [{ leg: "out", seats: 3, meetKind: "school", meetAt: meet }] } });
    const OUT = r.body?.offers?.[0]?.id;
    ok("she offers a lift there", r.status === 200 && Boolean(OUT));
    r = await api("/api/lifts/requests-mine", { token: driver });
    ok("no request yet: an empty list, not a zero row", r.status === 200 && r.body.rows.length === 0, r.body);
    r = await api(`/api/lifts/${OUT}/seats`, { method: "POST", token: bekker, body: { playerId: BEKKER } });
    const S_BEKKER = r.body?.seatId;
    ok("A Bekker asks for her son", r.status === 200 && Boolean(S_BEKKER));
    r = await api(`/api/lifts/${OUT}/seats`, { method: "POST", token: parent, body: { playerId: PILLAY } });
    const S_PILLAY = r.body?.seatId;
    ok("R Pillay's parent asks for hers", r.status === 200 && Boolean(S_PILLAY));
    r = await api("/api/lifts/requests-mine", { token: driver });
    const row = r.body?.rows?.[0];
    ok("the driver: one row, her lift, 2 requested (R5)", r.status === 200 && r.body.rows.length === 1 && row.offerId === OUT && row.matchId === m.id
       && row.requested === 2 && row.leg === "out" && row.schoolId === HIL && row.team === "1XI", r.body);
    ok("...its keys are the lift's and a count: no player, no seat, no name", JSON.stringify(Object.keys(row ?? {}).sort())
       === JSON.stringify(["leg", "matchId", "meetAt", "offerId", "requested", "schoolId", "team"]) && !OTHER_NAMES.test(JSON.stringify(r.body)) && !/Pillay/.test(JSON.stringify(r.body)));
    const before = await logRows();
    await api("/api/lifts/requests-mine", { token: driver });
    ok("...and reading it writes nothing to the access log", (await logRows()) === before);
    for (const [who, t] of /** @type {const} */ ([["a family who asked (she drives nothing)", bekker], ["another parent", parent], ["the side's coach", coach], ["the office", office]])) {
      r = await api("/api/lifts/requests-mine", { token: t });
      ok(`${who}: no row`, r.status === 200 && r.body.rows.length === 0, r.body);
    }
    r = await api("/api/lifts/requests-mine", { token: boy });
    ok("the pupil: nothing (db/70's pupil cut)", (r.status === 200 && r.body.rows.length === 0) || r.status === 403, r.status);

    // The seat states the list reads, each at its own family only.
    r = await api(`/api/matches/${m.id}/lifts`, { token: parent });
    let o = r.body?.rows?.find((/** @type {any} */ x) => x.id === OUT);
    ok("R Pillay's parent reads her son's seat as requested (R4 inside 48 hours of meeting), and no other boy's",
       o?.mySeats?.length === 1 && o.mySeats[0].playerId === PILLAY && o.mySeats[0].status === "requested" && !OTHER_NAMES.test(JSON.stringify(o.mySeats)), o?.mySeats);
    ok("...the meeting is inside 48 hours", new Date(meet).getTime() - Date.now() < 48 * 3600e3);
    ok("A Bekker reads hers and not R Pillay's", (await api(`/api/matches/${m.id}/lifts`, { token: bekker })).body?.rows?.find((/** @type {any} */ x) => x.id === OUT)?.mySeats?.map((/** @type {any} */ s) => s.playerId).join() === BEKKER);
    ok("the driver accepts both", (await api(`/api/lifts/${OUT}/accept`, { method: "POST", token: driver, body: { seatIds: [S_BEKKER, S_PILLAY] } })).status === 200);
    r = await api("/api/lifts/requests-mine", { token: driver });
    ok("accepted: no request is left to answer (R5 clears)", r.status === 200 && r.body.rows.length === 0, r.body);
    await q(`update match set starts_at = starts_at + interval '1 hour' where id = $1`, [m.id]);
    r = await api(`/api/matches/${m.id}/lifts`, { token: driver });
    o = r.body?.rows?.find((/** @type {any} */ x) => x.id === OUT);
    ok("the fixture moves: the driver reads her own lift as waiting on her (R6)", o?.mine === true && o.awaitingDriver === true, o);
    ok("...and the families' seats wait on the driver first (no R3 yet)", (await api(`/api/matches/${m.id}/lifts`, { token: parent })).body?.rows?.find((/** @type {any} */ x) => x.id === OUT)?.mySeats?.[0]?.status === "awaiting_driver");
    ok("she still offers it", (await api(`/api/lifts/${OUT}/reaffirm`, { method: "POST", token: driver, body: { version: o?.version } })).status === 200);
    r = await api(`/api/matches/${m.id}/lifts`, { token: parent });
    ok("now R Pillay's seat waits on his family: awaiting_guardian (R3)", r.body?.rows?.find((/** @type {any} */ x) => x.id === OUT)?.mySeats?.[0]?.status === "awaiting_guardian");
    ok("A Bekker's too, on her own read", (await api(`/api/matches/${m.id}/lifts`, { token: bekker })).body?.rows?.find((/** @type {any} */ x) => x.id === OUT)?.mySeats?.[0]?.status === "awaiting_guardian");
    ok("R Pillay's parent confirms again", (await api(`/api/lift-seats/${S_PILLAY}/reconfirm`, { method: "POST", token: parent })).status === 200);
    ok("...and her son's seat is confirmed (R3 clears for her); A Bekker's still waits on her (hers is her own)",
       (await api(`/api/matches/${m.id}/lifts`, { token: parent })).body?.rows?.find((/** @type {any} */ x) => x.id === OUT)?.mySeats?.[0]?.status === "confirmed"
       && (await api(`/api/matches/${m.id}/lifts`, { token: bekker })).body?.rows?.find((/** @type {any} */ x) => x.id === OUT)?.mySeats?.[0]?.status === "awaiting_guardian");
    r = await api(`/api/matches/${m.id}/lifts`, { token: ended });
    ok("the parent whose link has ended reads no lift on the side", (r.status === 200 && r.body.rows.length === 0) || r.status === 403, r.body);
    await grant(false);
    r = await api("/api/lifts/requests-mine", { token: driver });
    ok("the module taken back: module_disabled again (the list says nothing, D8)", r.status === 403 && r.body?.error === "module_disabled");
  }

  group("5. Two children at two schools: per child, nothing across");
  {
    const c = (await read("consents", sarah)).body?.rows ?? [];
    ok("Sarah's consents: one row per child of hers, each his own, nothing of any other child", c.length === 2
       && c.map((/** @type {any} */ x) => x.player_id).sort().join() === [KD, DM].sort().join(), c.map((/** @type {any} */ x) => x.full_name));
    const p = (await read("consents", parent)).body?.rows ?? [];
    ok("R Pillay's parent's consents: his row only, health monitoring off at Hilton (no R8c)", p.length === 1 && p[0].player_id === PILLAY && p[0].module_on === false, p);
    const [hilFixture] = await q(`select id from match where school_id = $1 and team_code = '1XI' and status = 'scheduled' order by starts_at limit 1`, [HIL]);
    const wes = (await read("availability", wesCoach, `?matchId=${hilFixture.id}`)).body?.rows ?? [];
    ok("a Westville reader's availability of a Hilton fixture: nothing", wes.length === 0, wes.length);
    const own = (await read("availability", parent, `?matchId=${hilFixture.id}`)).body?.rows ?? [];
    ok("R Pillay's parent's availability of his fixture: his row, and no other boy's", own.length >= 1 && own.every((/** @type {any} */ x) => x.player_id === PILLAY), own.map((/** @type {any} */ x) => x.full_name));
    const pn = await api(`/api/players/${DM}/public-name`, { token: sarah });
    ok("Sarah answers for D Mkhize at Westville: her own answer for him", pn.status === 200 && pn.body.mine?.state === "not_answered");
  }

  group("6. A pending request and an ended link: said, and nothing of a child");
  {
    const r = await api("/api/onboard", { method: "POST", body: { email: "pending.parent@example.invalid", name: "P Parent", role: "guardian", schoolId: HIL,
      note: "For my son in the 1st XI" } });
    ok("a stranger asks to be linked as a guardian", r.status === 200 || r.status === 201, r.body);
    const stranger = await login("pending.parent@example.invalid");
    const reqs = (await read("role_requests", stranger)).body?.rows ?? [];
    ok("her own request reads back: pending, hers, with the school's name and her own note",
       reqs.length === 1 && reqs[0].mine === true && reqs[0].state === "pending" && reqs[0].role === "guardian"
       && reqs[0].school_name === "Hilton College" && reqs[0].note === "For my son in the 1st XI" && reqs[0].player_id === null, reqs);
    ok("...and my_children gives her no child", ((await read("my_children", stranger)).body?.rows ?? []).length === 0);
    ok("...nor a count for any child", (await count(stranger, PILLAY))?.length === 0);
    ok("...nor a consent", ((await read("consents", stranger)).body?.rows ?? []).length === 0);
    const [m] = await q(`select id from match where school_id = $1 and team_code = '1XI' and status = 'scheduled' order by starts_at limit 1`, [HIL]);
    const decl = await api(`/api/matches/${m.id}/availability`, { method: "POST", token: ended, body: { playerId: NAIDOO, status: "available" } });
    ok("the parent whose link has ended may not declare for him", decl.status >= 400, decl.status);
    ok("...and reads nothing of him in the counts or the consents", (await count(ended, NAIDOO))?.length === 0
       && ((await read("consents", ended)).body?.rows ?? []).length === 0);
  }

  group("7. Everything R Pillay's parent's list reads, as one: her son's, and nobody else's");
  {
    const [m] = await q(`select id from match where school_id = $1 and team_code = '1XI' and status = 'scheduled' order by starts_at limit 1`, [HIL]);
    const bodies = [
      (await read("my_children", parent)).body,
      (await read("availability", parent, `?matchId=${m.id}`)).body,
      (await read("consents", parent)).body,
      (await read("emergency_contact_count", parent, `?playerId=${PILLAY}`)).body,
      (await api(`/api/players/${PILLAY}/public-name`, { token: parent })).body,
      (await read("role_requests", parent)).body,
    ];
    const all = JSON.stringify(bodies);
    ok("no other child's name in any of it", !OTHER_NAMES.test(all), all.match(OTHER_NAMES)?.[0]);
    // Ids and timestamps are digits too: a number to ring is what is left once they are taken out.
    const words = all.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "").replace(/\d{4}-\d\d-\d\d(T[\d:.]+(Z|[+-]\d\d:\d\d)?)?/g, "");
    ok("no phone, no email", !PHONE.test(words) && !/@/.test(words.replace(/"email":null/g, "")), words.match(PHONE)?.[0]);
    ok("every child id in it is her son's", [...all.matchAll(/"(?:player_id|playerId)":"([0-9a-f-]{36})"/g)].every((x) => x[1] === PILLAY));
  }
} catch (e) {
  fail++;
  console.log("  ✗ the walk threw:", /** @type {Error} */ (e)?.stack ?? e);
} finally {
  await grant(false).catch(() => {});
  await pool.end().catch(() => {});
  server.kill();
}
if (fail && serverErr.length) console.log(serverErr.join("").split("\n").slice(-15).join("\n"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

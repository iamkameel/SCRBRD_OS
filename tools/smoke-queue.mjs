#!/usr/bin/env node
/**
 * The match-day queue's reads, over HTTP (GA-I09–I11 slice A1;
 * docs/design/GA-I09-I11_match_day_queue.md §8, "API walks"). The queue adds
 * no read, no gate and no migration: every row on the "To resolve" screen is
 * derived in the browser from a read that already exists, so what is proved
 * here is that each of those reads answers for the readers the design names
 * and for nobody else.
 *
 *   1. THE DIRECTOR (a school-wide assignment): readiness, match_duties,
 *      trips and match_squad answer for every fixture at the school; he holds
 *      neither lift capability, so lift_expected and lift_exceptions give
 *      nothing, and leave no line in the access log.
 *   2. THE OFFICE (schooladmin): role_requests returns the pending requests
 *      with `decidable`, and `asked_unverified` true for the one asked before
 *      the email was verified and false for the one a signed-in person made;
 *      sign_in_claims returns the claim waiting; clearance_register returns
 *      the expired clearance; lift_exceptions returns the late lift and writes
 *      ONE access-log line for each call (and the queue makes none until the
 *      office taps).
 *   3. THE SPORTS ADMIN holds the register and the lifts and not the
 *      requests or the claims (no user.role.assign, no user.invite).
 *   4. THE PRINCIPAL: readiness gives no rows (no availability.read);
 *      match_duties does.
 *   5. A COACH OF TWO SIDES (2XI and 3XI): readiness answers for both
 *      fixtures and gives nothing for a third side's at the same school.
 *   6. THE SCORER, THE PUPIL AND A PARENT: none of the office's reads gives
 *      them a row, and no lift read does.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-queue.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";
import { ownerUrl, appUrl, port } from "./db-url.mjs";

const PORT = port(8995);
const BASE = `http://127.0.0.1:${PORT}`;
const HIL = "11111111-1111-1111-1111-111111111111";
const WHITFIELD = "aaaaaaaa-0000-0000-0000-000000000001";
const BEKKER = "aaaaaaaa-0000-0000-0000-000000000002";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${String(JSON.stringify(d)).slice(0, 240)}`); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-queue-secret" },
  stdio: ["ignore", "pipe", "pipe"],
});
const serverErr = [];
server.stderr.on("data", (d) => serverErr.push(d.toString()));

const api = async (path, { method = "GET", token, body } = {}) => {
  const res = await fetch(BASE + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const login = async (email) => (await api("/api/auth/dev-login", { method: "POST", body: { email, deviceId: "device-queue" } })).body?.token;
const read = (token, path) => api(`/api/read/${path}`, { token });
const rows = async (token, path) => (await read(token, path)).body?.rows ?? [];
const nothing = (r) => r.status === 403 || r.status === 401 || (r.status === 200 && (r.body?.rows ?? []).length === 0);

const pool = new pg.Pool({ connectionString: ownerUrl() });
const q = async (t, p) => (await pool.query(t, p)).rows;
const logged = async (resource) => (await q(`select count(*)::int c from access_log where resource = $1`, [resource]))[0].c;

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  // ── The stage ──────────────────────────────────────────────────────────
  group("Set the stage: three sides' fixtures tomorrow, two requests, a claim, an expired clearance, a late lift");
  const mk = async (team, opponent, hour) => (await q(
    `insert into match (school_id, team_code, opponent, starts_at, sport, format, overs, status)
     values ($1, $2, $3, (sa_today()::timestamp + interval '1 day' + make_interval(hours => $4::int)) at time zone 'Africa/Johannesburg', 'cricket', 'T20', 20, 'scheduled') returning id`,
    [HIL, team, opponent, hour]))[0].id;
  const F = { u15a: await mk("2XI", "Queue Kearsney", 9), u14b: await mk("3XI", "Queue Michaelhouse", 11), u16c: await mk("4XI", "Queue Clifton", 11), xi: await mk("1XI", "Queue Westville", 10) };
  const born = "current_date - interval '19 years'";   // adults: selecting a minor needs a verified guardian link and consent, which is not what this walk is about
  const kid = async (team, n) => (await q(`insert into player (school_id, team_code, full_name, squad_no, playing_role, born) values ($1, $2, $3, $4, 'batter', ${born}) returning id`, [HIL, team, `Q ${team} Fictional ${n}`, 40 + n]))[0].id;
  const kids = { "2XI": [await kid("2XI", 1), await kid("2XI", 2)], "3XI": [await kid("3XI", 1)], "4XI": [await kid("4XI", 1), await kid("4XI", 2)] };
  for (const [team, fx] of [["2XI", F.u15a], ["3XI", F.u14b], ["4XI", F.u16c]]) {
    await q(`insert into match_squad (match_id, player_id, side, batting_no) select $1, p, 'home', n from unnest($2::uuid[]) with ordinality as t(p, n)`, [fx, kids[team]]);
  }
  await q(`insert into app_user (school_id, email, name, role, teams) values ($1, 'queue.coach@example.invalid', 'Q Coach', 'coach', '{2XI,3XI}')`, [HIL]);
  await q(`insert into app_user (school_id, email, name, role, teams) values ($1, 'queue.sports@example.invalid', 'Q Sports', 'sportsadmin', '{}')`, [HIL]);
  await q(`insert into role_assignment (person_id, role, school_id) select id, 'sportsadmin', school_id from app_user where email = 'queue.sports@example.invalid'`);
  for (const team of ["2XI", "3XI"]) await q(`insert into role_assignment (person_id, role, school_id, team_code) select id, 'coach', school_id, $2 from app_user where email = $1`, ["queue.coach@example.invalid", team]);

  // Two requests: a stranger asks before the email is verified (POST /api/onboard), and a signed-in person asks for himself.
  const stranger = await api("/api/onboard", { method: "POST", body: { email: "queue.stranger@example.invalid", name: "Q Stranger", role: "coach", schoolId: HIL, teamCode: "U13A", note: "Joining." } });
  const watcher = await login("watcher@example.invalid");
  const asked = await api("/api/requests", { method: "POST", token: watcher, body: { role: "assistantcoach", schoolId: HIL, teamCode: "U13B", note: "Hello." } });
  ok("a stranger's request is made, and a signed-in person's", stranger.status === 200 && (asked.status === 200 || asked.status === 201), [stranger.status, asked.status, asked.body]);
  // A Google sign-in whose verified address matches an enrolled account (a parent's), waiting for the office.
  const CELE = (await q(`select id from app_user where email = 'parent.cele@example.invalid'`))[0].id;
  await q(`insert into pending_claim (provider, provider_uid, email, user_id) values ('google.com', 'queue-claim-1', 'cele.parent@gmail.invalid', $1)`, [CELE]);
  // An adult whose clearance has run out.
  const NDLOVU = (await q(`select id from app_user where email = 'e.ndlovu@example.invalid'`))[0].id;
  await q(`delete from adult_clearance where person_id = $1 and kind = 'police_clearance'`, [NDLOVU]);
  await q(`insert into adult_clearance (person_id, school_id, kind, issued_on, expires_on) values ($1, $2, 'police_clearance', current_date - 180, current_date - 10)`, [NDLOVU, HIL]);

  const director = await login("sarah@example.invalid"), office = await login("registrar@example.invalid"), sports = await login("queue.sports@example.invalid"),
        principal = await login("principal@example.invalid"), coach2 = await login("queue.coach@example.invalid"), scorer = await login("scorer@example.invalid"),
        pupil = await login("pillay@example.invalid"), parent = await login("parent.whitfield@example.invalid"), head = principal;
  ok("the readers sign in", [director, office, principal, coach2, scorer, pupil, parent].every(Boolean));

  // A late lift, so the office has an exception to read (and to be logged).
  await q(`insert into feature_grant (key, school_id, granted, note) values ('lift_club', $1, true, 'smoke-queue') on conflict (key, school_id) do update set granted = true`, [HIL]);
  await api("/api/lifts/policy", { method: "POST", token: head, body: { schoolId: HIL, body: "Lifts are arranged between families; the school facilitates and does not operate them. A driver undertakes that she holds a licence, that the car is insured and roadworthy, and that every boy wears a belt." } });
  const driver = await login("parent.whitfield@example.invalid"), mum = await login("parent.bekker@example.invalid");
  const card = (await q(`select id from emergency_contact where player_id = $1 and active order by priority limit 1`, [WHITFIELD]))[0];
  await api("/api/lifts/declaration", { method: "POST", token: driver, body: { schoolId: HIL, vehicle: "silver Toyota Fortuner", registration: "nd 123-456", seats: 3,
    licenceHeld: true, insured: true, roadworthy: true, belts: true, codeAcknowledged: true, contactId: card?.id } });
  await q(`insert into match_squad (match_id, player_id, side, batting_no) values ($1, $2, 'home', 1), ($1, $3, 'home', 2)`, [F.xi, WHITFIELD, BEKKER]);
  const start = new Date((await q(`select starts_at from match where id = $1`, [F.xi]))[0].starts_at);
  const meet = new Date(start.getTime() - 105 * 60000).toISOString();
  const offer = await api(`/api/matches/${F.xi}/lifts`, { method: "POST", token: driver, body: { legs: [
    { leg: "out", seats: 3, meetKind: "school", meetAt: meet }, { leg: "back", seats: 3, meetKind: "ground", meetAt: new Date(start.getTime() + 300 * 60000).toISOString() }] } });
  const OUT = offer.body?.offers?.find((o) => o.leg === "out")?.id;
  const seat = OUT ? await api(`/api/lifts/${OUT}/seats`, { method: "POST", token: mum, body: { playerId: BEKKER } }) : { body: null };
  if (OUT && seat.body?.seatId) await api(`/api/lifts/${OUT}/accept`, { method: "POST", token: driver, body: { seatIds: [seat.body.seatId] } });
  if (OUT) await q(`update lift_offer set meet_at = now() - interval '3 hours' where id = $1`, [OUT]);
  ok("a lift is arranged for one boy and is late", !!OUT && !!seat.body?.seatId, [offer.status, offer.body, seat.body]);

  // ── 1 · The director ───────────────────────────────────────────────────
  group("The director (school-wide): the side, the sheet, the bus and the duties answer for every fixture; he holds no lift capability");
  {
    const ids = (await q(`select id from match where school_id = $1 and status = 'scheduled' order by starts_at`, [HIL])).map((r) => r.id);
    ok(`there are fixtures to read (${ids.length})`, ids.length >= 5);
    for (const resource of ["readiness", "match_duties", "trips", "match_squad"]) {
      const answers = await Promise.all(ids.map((id) => read(director, `${resource}?matchId=${id}`)));
      ok(`${resource} answers (200 with a rows list) for every one of the ${ids.length} fixtures`, answers.every((r) => r.status === 200 && Array.isArray(r.body?.rows)), answers.filter((r) => r.status !== 200).map((r) => r.status));
    }
    ok("readiness for a side with players gives rows", (await rows(director, `readiness?matchId=${F.u15a}`)).length >= 2);
    ok("the fixtures read lists the stage's fixtures", (await rows(director, "matches")).filter((m) => Object.values(F).includes(m.id)).length === 4);
    const before = { exc: await logged("lift_exceptions"), exp: await logged("lift_expected") };
    const direct = await api(`/api/lifts/exceptions?schoolId=${HIL}`, { token: director });
    const expected = await api(`/api/matches/${F.xi}/lifts/expected`, { token: director });
    ok("lift_exceptions gives the director nothing, lift_expected too", nothing(direct) && nothing(expected), [direct.status, direct.body, expected.status]);
    ok("...and neither leaves a line in the access log", await logged("lift_exceptions") === before.exc && await logged("lift_expected") === before.exp);
  }

  // ── 2 · The office ─────────────────────────────────────────────────────
  group("The office (schooladmin): the requests with `decidable` and `asked_unverified`, the claim, the expired clearance, the late lift");
  {
    const reqs = await rows(office, "role_requests");
    const pending = reqs.filter((r) => r.state === "pending" && r.decidable === true && r.school_id === HIL);
    const byEmail = Object.fromEntries(pending.map((r) => [r.email, r]));
    ok("both pending requests come back as decidable", !!byEmail["queue.stranger@example.invalid"] && !!byEmail["watcher@example.invalid"], pending.map((r) => r.email));
    ok("...the stranger's was asked before the email was verified, the signed-in person's was not", byEmail["queue.stranger@example.invalid"]?.asked_unverified === true && byEmail["watcher@example.invalid"]?.asked_unverified === false,
       [byEmail["queue.stranger@example.invalid"]?.asked_unverified, byEmail["watcher@example.invalid"]?.asked_unverified]);
    ok("...both carry the time they were asked (the queue shows the oldest's age)", pending.every((r) => !!r.requested_at));
    const claims = await rows(office, "sign_in_claims");
    ok("sign_in_claims returns the claim waiting, the account as enrolled beside the address Google verified, never the uid",
       claims.some((c) => c.account_email === "parent.cele@example.invalid" && c.presented_email === "cele.parent@gmail.invalid" && c.school_id === HIL && !!c.requested_at) && claims.every((c) => !("provider_uid" in c)), claims.map((c) => c.account_email));
    const reg = await rows(office, `clearance_register?schoolId=${HIL}`);
    ok("clearance_register returns the expired clearance, with its date", reg.some((r) => r.person_id === NDLOVU && r.kind === "police_clearance" && r.status === "expired" && String(r.expires_on).slice(0, 10) < new Date().toISOString().slice(0, 10)), reg.filter((r) => r.person_id === NDLOVU));
    ok("...and it refuses another school's", (await rows(office, "clearance_register?schoolId=22222222-2222-2222-2222-222222222222")).length === 0);

    const n0 = await logged("lift_exceptions");
    const one = await api(`/api/lifts/exceptions?schoolId=${HIL}`, { token: office });
    const n1 = await logged("lift_exceptions");
    const two = await api(`/api/lifts/exceptions?schoolId=${HIL}`, { token: office });
    const n2 = await logged("lift_exceptions");
    ok("lift_exceptions gives the office the late lift, by name", one.status === 200 && (one.body?.rows ?? []).some((r) => r.kind === "not_left" && r.playerId === BEKKER), one.body);
    ok("...and writes ONE access-log line for each call: +1, +1 (so the queue makes none until the office taps)", n1 === n0 + 1 && n2 === n1 + 1 && two.status === 200, [n0, n1, n2]);
  }

  // ── 3 · The sports admin ───────────────────────────────────────────────
  group("The sports admin: the register and the lifts, and not the requests or the claims");
  {
    const reg = await rows(sports, `clearance_register?schoolId=${HIL}`);
    ok("the register answers", reg.some((r) => r.person_id === NDLOVU && r.status === "expired"));
    ok("role_requests gives him nothing he could decide", (await rows(sports, "role_requests")).filter((r) => r.decidable === true).length === 0);
    ok("sign_in_claims gives him nothing (no user.invite)", (await rows(sports, "sign_in_claims")).length === 0);
    ok("lift_exceptions answers (he holds transport.lift.oversee)", (await api(`/api/lifts/exceptions?schoolId=${HIL}`, { token: sports })).status === 200);
  }

  // ── 4 · The principal ──────────────────────────────────────────────────
  group("The principal: no family answer reaches him (no availability.read), the duties yes");
  {
    // The read answers a roster to anyone who holds team.read; the family's half is row-level security's and the physio's half is
    // medical.status.read's. So 'no answers' is a column that is empty, not a read that gives no rows: which is why the queue asks the
    // read only of a reader whose own assignment grants the side panel (team.read AND availability.read), never of the principal.
    const pr = await rows(principal, `readiness?matchId=${F.u15a}`);
    ok("readiness gives him the roster and no declared answer for any boy (the family's half is not his)", pr.length >= 1 && pr.every((r) => r.declared_status == null && r.said_status == null && r.reason_kind == null), pr.map((r) => r.declared_status));
    const MICH = "77777777-0000-0000-0000-000000000002";
    ok("match_duties gives the seeded appointment", (await rows(principal, `match_duties?matchId=${MICH}`)).length >= 1);
    ok("the requests and the register answer; the claims do not (no user.invite)",
       (await rows(principal, "role_requests")).some((r) => r.decidable === true) && (await rows(principal, `clearance_register?schoolId=${HIL}`)).length > 0 && (await rows(principal, "sign_in_claims")).length === 0);
  }

  // ── 5 · A coach of two sides ───────────────────────────────────────────
  group("A coach of 2XI and 3XI: the side answers for both fixtures and for nothing else at the school");
  {
    const a = await rows(coach2, `readiness?matchId=${F.u15a}`), b = await rows(coach2, `readiness?matchId=${F.u14b}`), c = await rows(coach2, `readiness?matchId=${F.u16c}`);
    ok("2XI: his two boys", a.length === 2 && a.every((r) => r.team_code === "2XI"), a.map((r) => r.team_code));
    ok("3XI: his one boy", b.length === 1 && b.every((r) => r.team_code === "3XI"));
    ok("4XI (a side he does not coach): nothing", c.length === 0);
    ok("...the sheet and the duties follow the same line: the third side's sheet is not his", (await rows(coach2, `match_squad?matchId=${F.u16c}`)).length === 0);
    ok("he has no office list: no requests to decide, no claims, no register", (await rows(coach2, "role_requests")).filter((r) => r.decidable).length === 0
       && (await rows(coach2, "sign_in_claims")).length === 0 && (await rows(coach2, `clearance_register?schoolId=${HIL}`)).length === 0);
    ok("and no lift exceptions", nothing(await api(`/api/lifts/exceptions?schoolId=${HIL}`, { token: coach2 })));
  }

  // ── 6 · Not readers ────────────────────────────────────────────────────
  group("The scorer, a pupil and a parent: none of the office's reads gives them a row, and no lift read does");
  for (const [who, token] of [["scorer", scorer], ["pupil", pupil], ["parent", parent]]) {
    ok(`${who}: no request to decide, no claim, no register`, (await rows(token, "role_requests")).filter((r) => r.decidable).length === 0
      && nothing(await read(token, "sign_in_claims")) && nothing(await read(token, `clearance_register?schoolId=${HIL}`)));
    ok(`${who}: no lift exceptions, no expected list`, nothing(await api(`/api/lifts/exceptions?schoolId=${HIL}`, { token })) && nothing(await api(`/api/matches/${F.xi}/lifts/expected`, { token })));
  }
  {
    const sRead = await read(scorer, `readiness?matchId=${F.u15a}`);
    const answers = (r) => (r.body?.rows ?? []).filter((x) => x.declared_status != null || x.clinically_restricted === true || x.rtw_date != null || x.reason_kind != null);
    ok("the scorer's side read carries no family answer and no restriction (no availability.read, no medical.status.read)", nothing(sRead) || answers(sRead).length === 0, answers(sRead));
    const pRead = await read(pupil, `readiness?matchId=${F.u15a}`);
    ok("the pupil's carries none for a side he is not in", nothing(pRead) || answers(pRead).length === 0, answers(pRead));
    const gRead = await read(parent, `readiness?matchId=${F.u15a}`);
    ok("the parent's carries none for a side her son is not in", nothing(gRead) || answers(gRead).length === 0, answers(gRead));
  }

  ok("the API raised nothing unexpected", !serverErr.join("").match(/Unhandled|TypeError|ReferenceError/), serverErr.join("").slice(0, 300));
} catch (e) {
  fail++;
  console.log("  ✗ the walk itself threw", e?.stack ?? e);
} finally {
  server.kill();
  await pool.end().catch(() => {});
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

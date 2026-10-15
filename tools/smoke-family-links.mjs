#!/usr/bin/env node
/**
 * A child's links, and the reason for an ending, through the API (account
 * lifecycle slice 3, db/109; docs/design/ACCOUNT_LIFECYCLE.md §4, D12–D14).
 *
 *   1. `child_links?playerId` gives the office every link of a child with its
 *      standing, never his date of birth, and puts the read on the access log
 *      naming him. The principal and the director of sport read it too. A
 *      coach, the DSO, the boy's own parent and another school's office read
 *      nothing. A playerId that is not one is a 400.
 *   2. POST /api/players/:id/guardians/:link/revoke { kind, reason }: refused
 *      for the parent and the director of sport (403), for a link that is not this
 *      child's (404), without a kind, with an automatic kind, or without a
 *      ten-character reason (422); signed out, 401; a coach, who may not
 *      read the link, is told it is not there (404). Nothing moves.
 *   3. The office revokes Mum's link (custody). The read now shows it ended,
 *      how, by whom and why; the director of sport reads the reason too.
 *   4. Mum, signed in, reads one notice: the school and the date, not the
 *      child, not the reason. Dad does not read it.
 *   5. D14: before, the public-name rule names him through Mum's consent;
 *      after, he is "Batter" (db/47, unchanged).
 *   6. The link again: 409 no_open_link. Dad's, now his only one, by the old
 *      route (POST …/guardians/revoke { guardianId }) and the new: 409
 *      last_verified_link, in the function's words; nothing moves.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-family-links.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";
import { publicName } from "@scrbrd/policy/public";
import { ownerUrl, appUrl, port } from "./db-url.mjs";

const PORT = port(8941);
const BASE = `http://127.0.0.1:${PORT}`;
const HILTON = "11111111-1111-1111-1111-111111111111";
const OFFICE_ID = "88888888-0000-0000-0000-00000000000c";   // B Naicker, the school office
const WHY = "Custody order of the High Court, 3 October";

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${String(d).slice(0, 300)}` : ""); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, DATABASE_URL: appUrl(), PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-family-links-secret" },
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
const tokenFor = async (email) =>
  (await api("/api/auth/dev-login", { method: "POST", body: { email, deviceId: "device-family-links" } })).body?.token;
const links = (token, playerId) => api(`/api/read/child_links?playerId=${playerId}`, { token });
const revoke = (token, player, link, body) =>
  api(`/api/players/${player}/guardians/${link}/revoke`, { method: "POST", token, body });

const pool = new pg.Pool({ connectionString: ownerUrl() });
const q = async (t, p) => (await pool.query(t, p)).rows;

/** A boy at Hilton, 15, with Mum and Dad verified and agreed; Mum said yes to his name. */
async function stage() {
  const [boy] = await q(`insert into player (school_id, team_code, full_name, squad_no, playing_role, born)
                          values ($1, 'U15A', 'Walk Familylinks', 1094, 'batter', current_date - interval '15 years 2 months')
                          returning id`, [HILTON]);
  const [other] = await q(`insert into player (school_id, team_code, full_name, squad_no, playing_role, born)
                            values ($1, 'U14A', 'Walk Otherboy', 1095, 'bowler', current_date - interval '14 years')
                            returning id`, [HILTON]);
  /** @type {Record<string, string>} */
  const ids = { boy: boy.id, other: other.id };
  for (const k of ["mum", "dad"]) {
    const [u] = await q(`insert into app_user (school_id, email, name, role) values ($1, $2, $3, 'parent') returning id`,
                        [HILTON, `fl.${k}@example.invalid`, `FL ${k === "mum" ? "Mum" : "Dad"}`]);
    const [a] = await q(`insert into role_assignment (person_id, role, school_id) values ($1, 'guardian', $2) returning id`, [u.id, HILTON]);
    const [l] = await q(`insert into assignment_subject (assignment_id, player_id, relationship, verification_state, verified_by,
                           verified_at, consent_state, consent_version, consent_at, created_by, valid_from)
                         values ($1, $2, 'parent', 'verified', $3, now() - interval '20 days', 'granted', 'popia-2026-01',
                                 now() - interval '20 days', $3, current_date - 30) returning id`, [a.id, boy.id, OFFICE_ID]);
    ids[k] = u.id; ids[`a_${k}`] = a.id; ids[`l_${k}`] = l.id;
  }
  await q(`insert into public_name_consent (player_id, given_by, giver_assignment_id, giver_link_id, version, given_on, recorded_by)
           values ($1, 'guardian', $2, $3, 'popia-2026-01', current_date - 10, $4)`, [boy.id, ids.a_mum, ids.l_mum, OFFICE_ID]);
  return ids;
}

/** His name as a public page would say it, every fact but the consents in favour. */
async function nameOf(boy) {
  const [{ f }] = await q(`select public_name_facts($1) as f`, [boy]);
  return publicName({ on: new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Johannesburg" }),
    fullName: "Walk Familylinks", label: "Batter", typed: false, schoolOnPlatform: true, schoolPublished: true,
    neverPublic: false, namesOff: false, consents: f.consents ?? [] });
}

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const S = await stage();
  const office = await tokenFor("registrar@example.invalid");
  const principal = await tokenFor("principal@example.invalid");
  const sarah = await tokenFor("sarah@example.invalid");
  const coach = await tokenFor("coach@example.invalid");
  const dso = await tokenFor("dso@example.invalid");
  const wesOffice = await tokenFor("registrar.wes@example.invalid");
  const mum = await tokenFor("fl.mum@example.invalid");
  const dad = await tokenFor("fl.dad@example.invalid");
  ok("everybody is signed in", [office, principal, sarah, coach, dso, wesOffice, mum, dad].every(Boolean));

  // ── 1. The read ────────────────────────────────────────────────
  group("child_links: the office's read of a child's links (D12)");
  const r1 = await links(office, S.boy);
  const rows = r1.body?.rows ?? [];
  ok("the office reads both links", r1.status === 200 && rows.length === 2, JSON.stringify(r1.body).slice(0, 200));
  ok("...each with its guardian, state, deciders, dates and standing; never his date of birth",
     ["link_id", "guardian_name", "guardian_email", "verification_state", "verified_by_name", "consent_state",
      "valid_from", "valid_until", "live", "ending_kind", "ending_reason", "standing", "is_minor", "live_links"]
       .every((c) => c in (rows[0] ?? {})) && !rows.some((r) => "born" in r),
     Object.keys(rows[0] ?? {}).join(","));
  ok("...the standing line's facts: active, a minor, two verified links",
     rows.every((r) => r.standing === "active" && r.is_minor === true && r.live_links === 2 && r.live === true));
  const logged = await q(`select record_ids, school_id from access_log where resource = 'child_links' and person_id = $1`, [OFFICE_ID]);
  ok("the read is on the access log, at Hilton, naming the boy",
     logged.length === 1 && logged[0].school_id === HILTON && logged[0].record_ids.includes(S.boy), JSON.stringify(logged));
  for (const [name, token] of [["the principal", principal], ["the director of sport", sarah]]) {
    const r = await links(token, S.boy);
    ok(`${name} reads both links`, r.status === 200 && (r.body?.rows ?? []).length === 2, r.status);
  }
  for (const [name, token] of [["a coach", coach], ["the DSO (not by standing)", dso], ["his own mother", mum],
                               ["Westville's office", wesOffice]]) {
    const r = await links(token, S.boy);
    ok(`${name} reads nothing`, r.status === 200 && (r.body?.rows ?? []).length === 0, JSON.stringify(r.body).slice(0, 160));
  }
  ok("a playerId that is not one: 400", (await links(office, "not-a-uuid")).status === 400);
  ok("no playerId: nothing", ((await api("/api/read/child_links", { token: office })).body?.rows ?? []).length === 0);
  ok("signed out: refused", (await links(undefined, S.boy)).status === 401);

  // ── 2. Refusals ────────────────────────────────────────────────
  group("POST /api/players/:id/guardians/:link/revoke: refused, nothing moves");
  const body = { kind: "custody", reason: WHY };
  let r;
  for (const [name, token] of [["the parent herself", mum], ["the director of sport", sarah]]) {
    const r = await revoke(token, S.boy, S.l_mum, body);
    ok(`${name}: 403 not_permitted`, r.status === 403 && r.body?.error === "not_permitted", JSON.stringify(r.body));
  }
  // A coach may not even read the link, so it is not there for him: the same
  // answer as for a link that does not exist.
  r = await revoke(coach, S.boy, S.l_mum, body);
  ok("a coach: 404 no_such_link (he cannot tell it is there)", r.status === 404 && r.body?.error === "no_such_link", JSON.stringify(r.body));
  ok("signed out: 401", (await revoke(undefined, S.boy, S.l_mum, body)).status === 401);
  r = await revoke(office, S.other, S.l_mum, body);
  ok("a link that is not this child's: 404 no_such_link", r.status === 404 && r.body?.error === "no_such_link", JSON.stringify(r.body));
  r = await revoke(office, S.boy, "not-a-uuid", body);
  ok("a link id that is not one: 404", r.status === 404, r.status);
  for (const [name, b, code] of [["no kind", { reason: WHY }, "kind_required"],
                                 ["an automatic kind", { kind: "majority", reason: WHY }, "kind_not_allowed"],
                                 ["a short reason", { kind: "custody", reason: "  custody  " }, "reason_required"]]) {
    r = await revoke(office, S.boy, S.l_mum, b);
    ok(`${name}: 422 ${code}`, r.status === 422 && r.body?.error === code, JSON.stringify(r.body));
  }
  ok("...and the link is still verified, with no ending row",
     (await q(`select verification_state from assignment_subject where id = $1`, [S.l_mum]))[0].verification_state === "verified"
     && (await q(`select count(*)::int n from guardian_link_ending where link_id = $1`, [S.l_mum]))[0].n === 0);

  // ── 3. The office revokes ─────────────────────────────────────
  group("The office ends Mum's link, with a kind and a reason");
  ok("before: his name is public through Mum's consent", (await nameOf(S.boy)) === "W Familylinks", await nameOf(S.boy));
  r = await revoke(office, S.boy, S.l_mum, body);
  ok("200 ok", r.status === 200 && r.body?.ok === true, JSON.stringify(r.body));
  const after = (await links(office, S.boy)).body?.rows ?? [];
  const mumRow = after.find((x) => x.link_id === S.l_mum);
  ok("the read shows it ended: revoked, custody, the reason, the office's name, today",
     mumRow && mumRow.live === false && mumRow.verification_state === "revoked" && mumRow.ending_kind === "custody"
     && mumRow.ending_reason === WHY && mumRow.ended_by_name === "B Naicker" && !!mumRow.ending_on, JSON.stringify(mumRow));
  ok("...and his standing: one verified link left", after.every((x) => x.live_links === 1 && x.standing === "active"));
  const sarahRow = ((await links(sarah, S.boy)).body?.rows ?? []).find((x) => x.link_id === S.l_mum);
  ok("the director of sport (audit.read) reads the kind and the reason", sarahRow?.ending_kind === "custody" && sarahRow?.ending_reason === WHY);

  // ── 4. The notice ──────────────────────────────────────────────
  group("Mum is told: the school and the date; not the child, not the reason");
  const mine = ((await api("/api/read/notifications", { token: mum })).body?.rows ?? [])
    .filter((n) => n.title === "A link to a child has ended");
  ok("Mum reads one notice", mine.length === 1, JSON.stringify(mine).slice(0, 200));
  ok("...naming the school and the date",
     /^Your link to a child at Hilton College ended on \d{1,2} \w+ \d{4}\. The school office can say why; the platform does not\.$/.test(mine[0]?.body ?? ""),
     mine[0]?.body);
  ok("...and not the child or the reason",
     !/Familylinks|High Court/.test(JSON.stringify(mine)) && mine[0]?.subject_person_id == null);
  ok("Dad does not read it",
     !((await api("/api/read/notifications", { token: dad })).body?.rows ?? []).some((n) => n.title === "A link to a child has ended"));

  // ── 5. D14 ─────────────────────────────────────────────────────
  group("What went with it (D14)");
  ok("his name is off public pages: he is \"Batter\"", (await nameOf(S.boy)) === "Batter", await nameOf(S.boy));

  // ── 6. Again, and the last link ───────────────────────────────
  group("An ended link, and his last verified link");
  r = await revoke(office, S.boy, S.l_mum, body);
  ok("the same link again: 409 no_open_link", r.status === 409 && r.body?.error === "no_open_link", JSON.stringify(r.body));
  r = await revoke(office, S.boy, S.l_dad, body);
  ok("Dad's, now his only verified link: 409 last_verified_link", r.status === 409 && r.body?.error === "last_verified_link", JSON.stringify(r.body));
  r = await api(`/api/players/${S.boy}/guardians/revoke`, { method: "POST", token: office, body: { guardianId: S.dad } });
  ok("...and by the old route, in the same words", r.body?.error === "last_verified_link", JSON.stringify(r.body));
  ok("...and Dad's link is still verified",
     (await q(`select verification_state from assignment_subject where id = $1`, [S.l_dad]))[0].verification_state === "verified");
} catch (e) {
  fail++;
  console.log("\n  ✗ the walk threw:", e.message);
} finally {
  server.kill("SIGTERM");
  await pool.end().catch(() => {});
}

if (fail && serverErr.length) {
  console.log("\nServer stderr:\n" + serverErr.join("").split("\n").slice(0, 12).join("\n"));
}
console.log(`\n${"─".repeat(52)}\nFAMILY LINKS SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

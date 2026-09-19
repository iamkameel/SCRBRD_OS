#!/usr/bin/env node
/**
 * The disciplinary record, through the real routes (SCRBRD-053).
 *
 * `discipline.read` and `discipline.write` were in the catalogue and in six
 * role bundles for the whole of this project's history and gated nothing at
 * all — no table, no policy, no read resource. db/25 is the record; this walk
 * is the part db/99 cannot do, which is prove that the ROUTES in front of it
 * deliver the same answers Postgres does, end to end, over HTTP.
 *
 * THREE THINGS IT EXISTS TO PIN.
 *
 * The first is the umpire. An official is appointed per MATCH, and the
 * appointment is the whole of his authority: he files an incident from the
 * fixture he stood at, and the same request against a fixture he did not
 * stand at is refused by the INSERT policy's fixture anchor — and a matter
 * naming no fixture at all is refused too, because NULL on the resource
 * narrows. This is the only policy in the schema whose fixture anchor is
 * allowed to be NULL, which is how the same column carries the on-field /
 * off-field distinction.
 *
 * The second is that HE CANNOT READ WHAT HE FILED. `official` holds
 * discipline.write and not discipline.read. That asymmetry is why neither
 * write path uses RETURNING: Postgres applies the SELECT policy to a row an
 * INSERT returns, so `returning id` would have refused the writer this
 * capability exists for — and the error it raises says "new row violates
 * row-level security policy", which would have sent whoever hit it looking at
 * the wrong policy.
 *
 * The third is the log. Nothing on this table is masked, so the ONLY reason a
 * principal's read of a child's record is recorded is the RESTRICTED_FIELDS
 * entry naming its prose. A record nobody's read of is logged was half of
 * what the original finding was about.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-discipline.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";

const PORT = 8829;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const P_SELF   = "aaaaaaaa-0000-0000-0000-000000000005";  // R Pillay, 1XI, has an account
const P_U16B   = "aaaaaaaa-0000-0000-0000-000000000006";  // K Dlamini, another side
const P_WES    = "bbbbbbbb-0000-0000-0000-000000000001";  // D Mkhize, Westville
const M_STOOD  = "77777777-0000-0000-0000-000000000004";  // the match E Ndlovu umpired
const M_OTHER  = "77777777-0000-0000-0000-000000000002";  // one he did not
const U_UMPIRE = "88888888-0000-0000-0000-000000000023";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-discipline-secret" },
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
  method: "POST", body: { email, deviceId: "device-discipline" } })).body?.token;
const file = (player, token, body) => api(`/api/players/${player}/discipline`, { method: "POST", token, body });
const progress = (id, token, body) => api(`/api/discipline/${id}`, { method: "PATCH", token, body });
const read = async (token) => (await api("/api/read/disciplinary_records", { token })).body?.rows ?? [];

const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const umpire = await login("e.ndlovu@example.invalid");   // official, ONE fixture
  const head   = await login("sarah@example.invalid");      // directorofsport
  const prince = await login("principal@example.invalid");  // principal
  const office = await login("registrar@example.invalid");  // schooladmin, Hilton
  const league = await login("league@example.invalid");     // competitionadmin, NO school
  const pupil  = await login("pillay@example.invalid");      // the boy it is about
  const medic  = await login("medical@example.invalid");     // no disciplinary capability
  const coach  = await login("coach@example.invalid");       // 1XI coach
  const wesAdm = await login("registrar.wes@example.invalid"); // the other school's office
  const owner  = await login("owner@example.invalid");        // every capability, no school

  ok("the umpire has an account to sign in with", !!umpire);

  group("An official files from the match he stood at, and from no other");
  ok("a fixture he did not stand at is refused",
     (await file(P_SELF, umpire, { body: "Not my match.", matchId: M_OTHER })).status === 403);
  ok("...and so is a matter naming no fixture at all",
     (await file(P_SELF, umpire, { body: "Against the school at large." })).status === 403);
  const filed = await file(P_SELF, umpire, {
    body: "Dissent at the umpire's decision; sent from the field.", matchId: M_STOOD });
  ok("the match he did stand at is accepted", filed.status === 200);
  ok("...and reports what it wrote rather than an id he could not read",
     filed.body?.recorded === 1 && filed.body?.id === undefined);

  group("Authorship is the session's, and the record's tenant is the player's");
  const [row] = await q(`select * from disciplinary_record where match_id = $1`, [M_STOOD]);
  ok("the record names the person who actually filed it", row.recorded_by === U_UMPIRE);
  ok("...its school came from the player, not the payload",
     row.school_id === "11111111-1111-1111-1111-111111111111");
  ok("...and it starts open with nothing decided", row.state === "open" && row.outcome === null);

  group("And he cannot read back what he filed");
  ok("an official holds the write and not the read", (await read(umpire)).length === 0);

  group("The five readers the grants name, and nobody else");
  const mine = (await read(head)).find((r) => r.id === row.id);
  ok("the director of sport reads it", !!mine);
  ok("...and it names who filed it, not just a uuid", mine.recorded_by_name === "E Ndlovu");
  ok("the principal reads it", (await read(prince)).some((r) => r.id === row.id));
  ok("the school office reads it", (await read(office)).some((r) => r.id === row.id));
  // A pupil reading HIS OWN record: `selfaccess` is subject-scoped, so the
  // person anchor on the row has to be the child his assignment names.
  const own = await read(pupil);
  ok("the boy it is about reads his own", own.length === 1 && own[0].player_id === P_SELF);
  ok("medical staff read nothing", (await read(medic)).length === 0);
  ok("a coach reads nothing", (await read(coach)).length === 0);
  ok("the other school's office reads nothing", (await read(wesAdm)).length === 0);

  group("A competition administrator reads across schools, and is stamped for it");
  await q(`delete from access_log`);
  const seen = await read(league);
  ok("the league reads a record at a school it does not belong to",
     seen.some((r) => r.id === row.id));
  // The name is player.profile.read's to give and the league does not hold it.
  // The read query LEFT JOINs the player for exactly this reason: an inner
  // join would have returned an empty list instead of a nameless record.
  ok("...without the child's name", seen.every((r) => r.full_name === null));
  const platform = await q(`select * from access_log where resource = 'disciplinary_records'`);
  ok("every cross-school read is on the record, with no extra wiring",
     platform.length === 1 && platform[0].platform_wide === true);
  ok("...filed in the school whose child was read",
     platform[0].school_id === "11111111-1111-1111-1111-111111111111");

  group("...and so is an ordinary school-side read");
  await q(`delete from access_log`);
  await read(prince);
  const logged = await q(`select * from access_log where resource = 'disciplinary_records'`);
  ok("the principal's read writes an entry", logged.length === 1);
  ok("...naming the child it was about", (logged[0]?.record_ids ?? []).includes(P_SELF));
  ok("...and that the account itself was disclosed", (logged[0]?.fields ?? []).includes("body"));
  ok("...and not as a platform-wide read", logged[0]?.platform_wide === false);

  group("The account is the author's; the outcome is the school's");
  ok("a matter cannot be concluded without saying what happened",
     (await progress(row.id, head, { state: "concluded" })).body?.error === "outcome_required");
  ok("somebody who can read it cannot rewrite the account",
     (await progress(row.id, head, { body: "Not mine to write." })).body?.error === "not_the_author");
  ok("...and the account is unchanged",
     (await q(`select body from disciplinary_record where id = $1`, [row.id]))[0].body === row.body);
  // AND NEITHER CAN THE UMPIRE, which is not the trigger's doing. Postgres
  // applies SELECT policies to the rows an UPDATE's WHERE clause reads, so a
  // writer who may not read the record cannot name it either — the statement
  // matches nothing and the route answers 403. Filed from the field and not
  // his to rewrite afterwards, which is the right answer for a report that is
  // evidence; the school is who progresses it. Probed directly against
  // Postgres 16 rather than inferred: the same UPDATE with no WHERE clause
  // DOES touch every row his appointment covers, because nothing is read.
  // Every write here names an id for that reason.
  ok("the umpire cannot revise his own report, because he cannot name it",
     (await progress(row.id, umpire, { body: "Second thoughts." })).status === 403);
  const concluded = await progress(row.id, head, {
    state: "concluded", outcome: "Two matches missed; apology delivered to the umpire." });
  ok("the school concludes a matter an official filed", concluded.status === 200);
  const [after] = await q(`select * from disciplinary_record where id = $1`, [row.id]);
  ok("...and the record says so", after.state === "concluded" && !!after.outcome);
  ok("...with authorship still the umpire's", after.recorded_by === U_UMPIRE);
  ok("...and the account still his words", after.body === row.body);
  ok("...and the revision stamped", after.updated_at !== null);

  group("A school-side author does revise her own, and nobody else's");
  await file(P_U16B, head, { body: "Repeated lateness to training; spoke to the boy." });
  const hers = (await read(head)).find((r) => r.player_id === P_U16B);
  ok("the director of sport files an off-field matter with no fixture behind it",
     !!hers && hers.match_id === null);
  ok("...and may revise her own account",
     (await progress(hers.id, head, { body: "Repeated lateness; spoke to the boy and to his mother." })).status === 200);
  // THREE REFUSALS THAT MUST NOT COLLAPSE INTO ONE. The principal reads a
  // record and holds no write at all, so row-level security refuses him and
  // the answer is not_permitted. The owner holds the write and did not file
  // this one, so the trigger refuses the account and the answer is
  // not_the_author. The same owner may still conclude it, because that is the
  // school's half of the row rather than the author's.
  ok("the principal reads a matter and cannot touch it",
     (await progress(hers.id, prince, { state: "withdrawn", outcome: "No further action." }))
       .body?.error === "not_permitted");
  ok("the owner, who holds the write and did not file it, cannot rewrite the account",
     (await progress(hers.id, owner, { body: "Not mine to write." })).body?.error === "not_the_author");
  ok("...and may conclude it",
     (await progress(hers.id, owner, { state: "withdrawn", outcome: "Raised in error; no further action." })).status === 200);

  group("A record does not move to another child");
  const moved = await q(
    `update disciplinary_record set player_id = $2 where id = $1 returning id`,
    [row.id, P_U16B]).then(() => "written").catch((e) => e.code);
  ok("the trigger refuses it even for the table owner", moved === "45002");

  group("Nobody writes about a child at another school");
  ok("the director of sport cannot file against a Westville pupil",
     (await file(P_WES, head, { body: "Not our pupil." })).status === 403);
  ok("nor can medical staff file about their own school's",
     (await file(P_SELF, medic, { body: "Not a disciplinary judgement." })).status === 403);
  ok("an empty account is refused",
     (await file(P_SELF, head, { body: "   " })).body?.error === "body_required");
  ok("an unknown state is refused",
     (await progress(row.id, head, { state: "appealed" })).body?.error === "unknown_state:appealed");
  ok("a progression that changes nothing is refused",
     (await progress(row.id, head, {})).body?.error === "nothing_to_change");

  group("Nothing here can be erased");
  const d = (await q(`select count(*)::int n from pg_policy
                       where polrelid = 'disciplinary_record'::regclass and polcmd = 'd'`))[0].n;
  ok("there is no delete policy", d === 0);
  ok("and the application role holds no DELETE",
     (await q(`select has_table_privilege('scrbrd_app','disciplinary_record','DELETE') as d`))[0].d === false);
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
console.log(`\n${"─".repeat(52)}\nDISCIPLINARY RECORD SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

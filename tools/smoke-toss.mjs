#!/usr/bin/env node
/**
 * The toss, and the moment it stops being editable.
 *
 * Third instance of the same disease as the squad: `match` carried
 * toss_won_by/toss_decision since the first migration, the scorer's setup
 * wizard collects both, and nothing ever wrote them. The toss lived in one
 * browser's React state, decided that session's innings order, and vanished.
 *
 * Worse than merely unsaved: the winner was free text holding a school's
 * display name, and a fixture's away side is free text too. Nothing tied the
 * toss winner to either team playing, so who bats first — the fact the whole
 * innings order rests on — was not computable from the data at all.
 *
 * This walk proves the toss is now a side, that the server derives who bats,
 * and that the answer freezes the moment a delivery exists.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-toss.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";

const PORT = 8810;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const HIL = "11111111-1111-1111-1111-111111111111";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-toss-secret" },
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
  method: "POST", body: { email, deviceId: "device-toss" } })).body?.token;
const callToss = (match, token, wonBy, decision) =>
  api(`/api/matches/${match}/toss`, { method: "POST", token, body: { wonBy, decision } });

const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const scorer    = await login("scorer@example.invalid");     // scoring.start over {1XI}
  const spectator = await login("spectator@example.invalid");  // fixture.read only
  const parent    = await login("parent@example.invalid");
  const u14coach  = await login("u14coach@example.invalid");   // a coach, but of U14A

  const newMatch = async (team = "1XI") => (await q(
    `insert into match (school_id, team_code, opponent, starts_at, format, overs, status)
     values ($1,$2,'Michaelhouse', now() + interval '1 day','T20',20,'scheduled') returning id`,
    [HIL, team]))[0].id;

  const m = await newMatch();

  group("The scorer calls the toss");
  const first = await callToss(m, scorer, "home", "bat");
  ok("it is recorded", first.status === 200);
  ok("the winner comes back as a side, not a school name", first.body?.wonBy === "home");
  ok("the decision comes back", first.body?.decision === "bat");
  // The whole point of the move. The server answers this; before, every client
  // worked it out for itself from a name that matched neither side reliably.
  ok("the server says who bats first", first.body?.batsFirst === "home");
  ok("the call is timestamped", !!first.body?.calledAt);
  const stored = await q(`select won_by, decision, called_by from match_toss where match_id = $1`, [m]);
  ok("one row, not two", stored.length === 1);
  ok("who called it is recorded", !!stored[0].called_by);

  group("Who bats first, all four ways round");
  // Won and chose to bat → they bat. Won and chose to bowl → the other side.
  // Trivial arithmetic, and it is only expressible because the winner is a side.
  const combos = [
    ["home", "bat",  "home"], ["home", "bowl", "away"],
    ["away", "bat",  "away"], ["away", "bowl", "home"],
  ];
  for (const [wonBy, decision, expected] of combos) {
    const r = await callToss(m, scorer, wonBy, decision);
    ok(`${wonBy} won and elected to ${decision} → ${expected} bats`,
       r.status === 200 && r.body?.batsFirst === expected);
  }

  group("Correcting a mistyped toss, before a ball is bowled");
  // A typo at the coin is a typo, not history. It is only after the first
  // delivery that changing it rewrites something people have read.
  await callToss(m, scorer, "home", "bat");
  const fixed = await callToss(m, scorer, "away", "bowl");
  ok("the correction is accepted", fixed.status === 200);
  ok("and it is the correction that stands", fixed.body?.batsFirst === "home");
  ok("still one row", (await q(`select 1 from match_toss where match_id = $1`, [m])).length === 1);

  group("Once play starts the toss is settled");
  // The precondition is a delivery in the log, inserted directly: this is
  // about what the trigger does once one exists, not about how it got there.
  const scorerUser = (await q(`select id from app_user where email = 'scorer@example.invalid'`))[0].id;
  await q(
    `insert into ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id,
                             device_id, idempotency_key, client_seq, client_ts, kind, payload)
     values ($1, $2, 1, 1, 1, $3, 'device-toss', $4, 1, now(), 'ball', '{}'::jsonb)`,
    [m, HIL, scorerUser, `toss-smoke-${Date.now()}-${Math.random()}`]);
  const late = await callToss(m, scorer, "home", "bat");
  ok("the change is refused", late.status === 409);
  ok("and named as locked, not as a validation error", late.body?.error === "toss_locked");
  ok("the message says play has started", /play has started/i.test(late.body?.detail || ""));
  // A coach told "invalid" has to guess. This one is told where to go instead.
  ok("and points at the amendment route", /amendment/i.test(late.body?.detail || ""));
  const after = await q(`select won_by, decision from match_toss where match_id = $1`, [m]);
  ok("the stored toss is untouched", after[0].won_by === "away" && after[0].decision === "bowl");

  group("Calling the toss is authorised like everything else");
  const m2 = await newMatch();
  ok("a spectator cannot", (await callToss(m2, spectator, "home", "bat")).status === 403);
  ok("a parent cannot", (await callToss(m2, parent, "home", "bat")).status === 403);
  // Scoped, not just role-gated: a U14 coach has no business on the 1XI match.
  ok("a coach of another team cannot", (await callToss(m2, u14coach, "home", "bat")).status === 403);
  ok("nothing was written", (await q(`select 1 from match_toss where match_id = $1`, [m2])).length === 0);
  // The seeded scorer's assignment carries team_code NULL, and NULL on an
  // ASSIGNMENT widens: they score anything at their school. That is the seed's
  // choice, not an accident, and app_user.teams='{1XI}' does not narrow it —
  // authority is role_assignment, not the display column.
  const m3 = await newMatch("U16B");
  ok("a school-wide scorer reaches another team's fixture",
     (await callToss(m3, scorer, "home", "bat")).status === 200);

  // The tightest scope the model has, and the one the roles module calls
  // normal for a scorer: assigned to a single fixture, so scoring one match
  // never becomes standing authority over the school's whole programme.
  const m5 = await newMatch();
  const m6 = await newMatch();
  // Idempotent: this walk is meant to be rerunnable without a --reset, and a
  // fixed email plus a fresh fixture each run means the assignment has to be
  // replaced rather than piled up. Two scorer assignments for one person would
  // silently widen the scope and quietly pass the test below.
  const fixtureScorer = (await q(
    `insert into app_user (school_id, email, name, role)
     values ($1, 'onefixture@example.invalid', 'One Fixture', 'scorer')
     on conflict (email) do update set name = excluded.name returning id`, [HIL]))[0].id;
  await q(`delete from role_assignment where person_id = $1`, [fixtureScorer]);
  await q(
    `insert into role_assignment (person_id, role, school_id, fixture_id)
     values ($1, 'scorer', $2, $3)`, [fixtureScorer, HIL, m5]);
  const onlyOne = await login("onefixture@example.invalid");
  ok("a fixture-scoped scorer calls the toss on their own match",
     (await callToss(m5, onlyOne, "home", "bat")).status === 200);
  ok("and cannot on the fixture next door",
     (await callToss(m6, onlyOne, "home", "bat")).status === 403);

  group("The request has to name a side and a choice");
  const m4 = await newMatch();
  // The old format. A school name is exactly what this table stopped accepting,
  // and the refusal has to be explicit rather than a silent NULL.
  ok("a school name is not a side", (await callToss(m4, scorer, "Hilton College", "bat")).status === 400);
  ok("nor is a team code", (await callToss(m4, scorer, "1XI", "bat")).status === 400);
  ok("a missing winner is refused", (await callToss(m4, scorer, undefined, "bat")).status === 400);
  ok("a made-up decision is refused", (await callToss(m4, scorer, "home", "field")).status === 400);
  ok("a missing decision is refused", (await callToss(m4, scorer, "home", undefined)).status === 400);
  ok("and none of it was written", (await q(`select 1 from match_toss where match_id = $1`, [m4])).length === 0);

  group("The toss reaches the read path");
  const read = await api("/api/read/matches", { token: scorer });
  const row = read.body?.rows?.find((r) => r.id === m);
  ok("the fixture carries its toss", row?.toss_won_by === "away" && row?.toss_decision === "bowl");
  ok("and who bats first, computed by the server", row?.bats_first === "home");
  const untossed = read.body?.rows?.find((r) => r.id === m2);
  ok("a fixture with no toss says so rather than guessing",
     untossed && untossed.toss_won_by === null && untossed.bats_first === null);

  group("No table is protected only by nobody having looked at it yet");
  // match_toss is the third table added to this schema in as many features,
  // and nothing in the suite would have failed if it had shipped with row
  // security off. Every existing table already passes, so the guard costs
  // nothing today and fails loudly the first time one does not — which is the
  // only moment it matters.
  const unprotected = await q(
    `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
      order by 1`);
  ok(`every table has row security on${unprotected.length ? ": " + unprotected.map(r => r.relname).join(", ") : ""}`,
     unprotected.length === 0);
  // RLS enabled with no policy means default deny, which is a legitimate
  // choice (login_code is exactly that) but never an accidental one. These are
  // the tables where that was decided on purpose; anything else joining them
  // is a new decision that should be made deliberately, not discovered later.
  // schema_migration is the migrator's ledger (tools/migrate.mjs): the owner
  // writes and reads it, and the application role has no business with it.
  const DELIBERATELY_NO_POLICY = new Set(["login_code", "schema_migration"]);
  const policyless = (await q(
    `select c.relname, count(p.polname)::int as policies
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       left join pg_policy p on p.polrelid = c.oid
      where n.nspname = 'public' and c.relkind = 'r'
      group by 1 having count(p.polname) = 0
      order by 1`)).filter((r) => !DELIBERATELY_NO_POLICY.has(r.relname));
  ok(`no table is silently unreachable${policyless.length ? ": " + policyless.map(r => r.relname).join(", ") : ""}`,
     policyless.length === 0);

} catch (e) {
  fail++; console.log("\n  ✗ threw:", e.message);
  if (serverErr.length) console.log(serverErr.join("").slice(-1500));
} finally {
  await pool.end().catch(() => {});
  server.kill();
  console.log("\n" + "─".repeat(52));
  console.log(`TOSS SMOKE: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

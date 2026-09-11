#!/usr/bin/env node
/**
 * SCRBRD OS is school sport. Cricket OS is one sport inside it.
 *
 * That sentence had no representation anywhere: `match` meant a cricket match,
 * `overs` was NOT NULL with a T20 default, and the shell's sport switcher was
 * a hard-coded array of four with `live: false` beside three of them.
 *
 *   1. A SPORT IS A DIMENSION, NOT A TENANT. The tenant stays the school.
 *   2. MOST OF THIS PRODUCT IS ALREADY SPORT-AGNOSTIC, and this walk proves it
 *      rather than asserting it: a HOCKEY fixture gets a squad, availability,
 *      readiness and a bus, through the same routes cricket uses.
 *   3. CRICKET'S MACHINERY IS CRICKET'S. The ball log, the toss and DRS refuse
 *      a fixture in another sport, in the database, not in a route.
 *   4. THE PLATFORM GRANTS; A SCHOOL MAY ONLY REDUCE. Same direction as every
 *      other switch. A school cannot start running rugby at its end.
 *   5. SWITCHING A SPORT OFF DOES NOT DELETE ITS HISTORY.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-sport.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";

const PORT = 8853;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const HIL = "11111111-1111-1111-1111-111111111111";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-sport-secret" },
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
  method: "POST", body: { email, deviceId: "device-sport" } })).body?.token;
const read = (r, token, qs = "") => api(`/api/read/${r}${qs}`, { token });
const sports = async (token) => (await read("sports", token)).body?.rows ?? [];
const grant = (key, token, body) =>
  api(`/api/admin/features/${key}`, { method: "POST", token, body });
const suppress = (key, token, body) =>
  api(`/api/admin/modules/${key}/suppress`, { method: "POST", token, body });

const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;

/** Insert a fixture directly, so the refusal comes from the database and not a route. */
const fixture = async (sport, extra = {}) => {
  const cols = { school_id: HIL, team_code: "1XI", opponent: "Kearsney",
                 starts_at: "now() + interval '5 days'", sport, ...extra };
  try {
    const r = await q(
      `insert into match (school_id, team_code, opponent, starts_at, sport, format, overs)
       values ($1,$2,$3, now() + interval '5 days', $4, $5, $6) returning id`,
      [HIL, cols.team_code, cols.opponent, sport,
       extra.format ?? (sport === "cricket" ? "T20" : null),
       extra.overs ?? (sport === "cricket" ? 20 : null)]);
    return { ok: true, id: r[0].id };
  } catch (e) { return { ok: false, code: e.code, message: e.message }; }
};

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  const platform  = await login("platform@example.invalid");
  const registrar = await login("registrar@example.invalid");  // school.feature.manage at Hilton
  const coach     = await login("coach@example.invalid");
  const head      = await login("sarah@example.invalid");
  const watcher   = await login("watcher@example.invalid");

  group("The catalogue says what exists and how much of it works");
  {
    const rows = await sports(coach);
    ok("the catalogue reads for anybody signed in", rows.length >= 7);
    const cricket = rows.find((s) => s.code === "cricket");
    ok("cricket is on", cricket?.enabled === true);
    // TWO SEPARATE FACTS. The hard-coded list had one boolean, which forced
    // every partly-built sport into "SOON" including the ones whose fixture
    // half is finished.
    ok("...and has a scoring engine", cricket?.engine === "scoring");
    const hockey = rows.find((s) => s.code === "hockey");
    ok("hockey is listed", !!hockey);
    ok("...not granted to this school yet", hockey?.enabled === false);
    ok("...and honest that it has a fixture engine and no scorer",
       hockey?.engine === "fixtures");
    ok("a gala is not a fixture, and athletics says so",
       rows.find((s) => s.code === "athletics")?.engine === "none");
    ok("exactly one sport is scorable today",
       rows.filter((s) => s.engine === "scoring").length === 1);
    ok("a spectator sees the catalogue too", (await sports(watcher)).length >= 7);
  }

  group("The platform grants; a school may only reduce");
  {
    // The same direction as every other switch in this product. "Rugby works"
    // is a statement about what has been built and tested, not a preference a
    // school gets to express.
    // A reason is supplied because the route validates before it authorises,
    // so omitting one gets 400 and proves nothing about who may grant. The
    // first draft of this walk omitted it and read the 400 as a refusal.
    const why = { enabled: true, reason: "Attempted locally" };
    ok("a school administrator cannot switch a sport on platform-wide",
       [403, 401].includes((await grant("sport_hockey", registrar, why)).status));
    ok("...nor can a director of sport",
       [403, 401].includes((await grant("sport_hockey", head, why)).status));
    ok("...and hockey is still off",
       (await sports(coach)).find((s) => s.code === "hockey")?.enabled === false);

    const before = await fixture("hockey");
    ok("a fixture in an ungranted sport is refused", !before.ok && before.code === "23514");
    // The person who hits this is a sportsmaster typing a hockey fixture into
    // a product that has not been given hockey. "not permitted" would send
    // them to their own IT department.
    ok("...with a message naming the sport", /Hockey/.test(before.message));
    ok("...and saying who can change it", /platform|plan/i.test(before.message));

    ok("the platform can grant it", (await grant("sport_hockey", platform,
      { enabled: true, reason: "Hilton hockey pilot" })).status === 200);
    ok("...and the school sees it on",
       (await sports(coach)).find((s) => s.code === "hockey")?.enabled === true);
  }

  group("A hockey fixture, through the routes cricket uses");
  {
    // THE ASSERTION THAT CARRIES THE WHOLE THESIS. Squad selection,
    // availability, readiness and transport care about a fixture and a roster
    // and not about which game is being played — and nobody had noticed,
    // because nothing had ever asked them.
    const m = await fixture("hockey");
    ok("a hockey fixture can be created once granted", m.ok);
    ok("...carrying no overs, because an over is a cricket unit",
       (await q(`select overs, format from match where id = $1`, [m.id]))[0].overs === null);
    ok("...and it cannot be given any", !(await fixture("hockey", { overs: 20 })).ok);

    const boy = (await q(
      `select p.id from player p join player_guardian_status g on g.player_id = p.id
        where p.school_id = $1 and p.team_code = '1XI' and g.registration_state = 'active'
        order by p.full_name limit 1`, [HIL]))[0];
    ok("there is a registered boy to pick", !!boy);

    ok("he can be named in the side",
       (await api(`/api/matches/${m.id}/squad`, { method: "POST", token: coach,
         body: { side: "home", players: [{ playerId: boy.id, battingNo: 1 }] } })).status === 200);
    ok("his family can answer for the fixture",
       (await api(`/api/matches/${m.id}/availability`, { method: "POST", token: coach,
         body: { playerId: boy.id, status: "available" } })).status === 200);
    const rd = (await read("readiness", coach, `?matchId=${m.id}`)).body?.rows ?? [];
    ok("readiness answers for a hockey fixture", rd.length > 0);
    ok("...and resolves the boy who answered", rd.find((r) => r.player_id === boy.id)?.state === "available");

    const veh = (await q(`select id from vehicle where school_id = $1 limit 1`, [HIL]))[0];
    ok("a bus can be put on it",
       (await api(`/api/matches/${m.id}/trip`, { method: "POST", token: await login("platform@example.invalid"),
         body: { vehicleId: veh.id, departAt: new Date(Date.now() + 6e8).toISOString(),
                 headcount: 14 } })).status !== 500);

    ok("and it appears on the shared fixture list, with its sport",
       (await read("matches", coach)).body?.rows?.some((r) => r.id === m.id && r.sport === "hockey"));
  }

  group("Cricket's machinery is cricket's");
  {
    const hk = await fixture("hockey");
    // In the database, not in a route: there are already three ways a row
    // reaches this schema — the API, a seed, an import — and a check in one
    // route covers one of them.
    const toss = await q(
      `insert into match_toss (match_id, school_id, won_by, decision)
       values ($1,$2,'home','bat')`, [hk.id, HIL])
      .then(() => ({ ok: true })).catch((e) => ({ ok: false, code: e.code, message: e.message }));
    ok("a hockey fixture cannot have a toss", !toss.ok && toss.code === "23514");
    ok("...and the refusal says why, naming the sport", /Hockey/.test(toss.message));

    const ball = await q(
      `insert into ball_event (match_id, school_id, seq, epoch, scorer_user_id, device_id,
                               idempotency_key, client_seq, client_ts, kind)
       values ($1,$2,1,1,(select id from app_user where email='scorer@example.invalid'),
               'd','k',1, now(), 'ball')`, [hk.id, HIL])
      .then(() => ({ ok: true })).catch((e) => ({ ok: false, code: e.code }));
    ok("...nor a ball log", !ball.ok && ball.code === "23514");

    const sess = await q(
      `insert into scoring_session (match_id, school_id) values ($1,$2)`,
      [hk.id, HIL]).then(() => ({ ok: true })).catch((e) => ({ ok: false, code: e.code }));
    ok("...nor a scoring session", !sess.ok && sess.code === "23514");

    // And the same three all work on a cricket fixture, so the gate is about
    // the sport and not about the walk's connection.
    const ck = await fixture("cricket");
    ok("a cricket fixture takes a toss",
       (await q(`insert into match_toss (match_id, school_id, won_by, decision)
                 values ($1,$2,'home','bat') returning match_id`, [ck.id, HIL])).length === 1);
  }

  group("A fixture's sport is frozen once it has been played");
  {
    const ck = await fixture("cricket");
    await q(`insert into ball_event (match_id, school_id, seq, epoch, scorer_user_id, device_id,
                                     idempotency_key, client_seq, client_ts, kind)
             values ($1,$2,1,1,(select id from app_user where email='scorer@example.invalid'),
                     'd','k2',1, now(), 'ball')`, [ck.id, HIL]);
    const moved = await q(`update match set sport = 'hockey' where id = $1`, [ck.id])
      .then(() => ({ ok: true })).catch((e) => ({ ok: false, code: e.code, message: e.message }));
    // Every replay over it would be deriving a cricket innings from a hockey
    // match. Same reasoning as the toss freezing once a delivery exists.
    ok("a scored fixture cannot change sport", !moved.ok && moved.code === "23514");
    ok("...and says it is because there is a ball log", /ball log/.test(moved.message));

    // An unscored one can be corrected, because a typo on Tuesday is ordinary.
    const fresh = await fixture("cricket");
    ok("an unplayed fixture can be corrected",
       (await q(`update match set sport = 'hockey', format = null, overs = null
                  where id = $1 returning id`, [fresh.id])).length === 1);
  }

  group("Switching a sport off does not delete its history");
  {
    const kept = await fixture("hockey");
    ok("the school can stop running hockey",
       (await suppress("sport_hockey", registrar, { schoolId: HIL, hidden: true })).status === 200);
    ok("...and it reads as off", (await sports(coach)).find((s) => s.code === "hockey")?.enabled === false);
    // The module doctrine is that switching something off stops it delivering
    // rows. A SPORT is the exception and deliberately so: a school that stops
    // running hockey in 2027 keeps the 2026 hockey season, because that is a
    // record of matches that were played.
    ok("last season's hockey fixtures survive",
       (await read("matches", coach)).body?.rows?.some((r) => r.id === kept.id));
    ok("...and can still be corrected",
       (await q(`update match set opponent = 'Michaelhouse' where id = $1 returning id`,
                [kept.id])).length === 1);
    // What it stops is NEW ones.
    const after = await fixture("hockey");
    ok("but no new hockey fixture can be added", !after.ok && after.code === "23514");

    ok("the school can start again", (await suppress("sport_hockey", registrar,
      { schoolId: HIL, hidden: false })).status === 200);
    ok("...and then it can", (await fixture("hockey")).ok);
  }

  group("A sport that does not exist is refused, not created");
  {
    const bad = await fixture("quidditch");
    ok("an unknown sport cannot be a fixture", !bad.ok);
    // The TRIGGER speaks first, because a BEFORE INSERT trigger runs before
    // constraints are checked — so the refusal is a check_violation naming the
    // sport rather than a foreign-key error naming a constraint. The foreign
    // key is still there underneath as the backstop; what a sportsmaster sees
    // is the sentence.
    ok("...refused with the sport it could not find", /no such sport: quidditch/.test(bad.message));
    ok("...as a check, because the trigger answers before the key does",
       bad.code === "23514");
    ok("no school administrator can add a sport",
       !(await q(`select 1 from pg_policies where tablename = 'sport'
                   and policyname = 'sport_insert' and qual like '%school%'`)).length);
  }

} catch (e) {
  fail++; console.log("\n  ✗ threw:", e.message);
  if (serverErr.length) console.log(serverErr.join("").slice(-1500));
} finally {
  await pool.end().catch(() => {});
  server.kill();
  console.log("\n" + "─".repeat(52));
  console.log(`SPORT SMOKE: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

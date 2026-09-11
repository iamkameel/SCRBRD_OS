#!/usr/bin/env node
/**
 * Batter against bowler.
 *
 * ball_event.striker_id and bowler_id exist so that attribution is available
 * to readers that are not the scoring device — the column comment names three
 * uses, and this is the one nothing had built. It is also the question a coach
 * asks out loud on the Friday: how has he gone against this bowler, and
 * against bowling like his.
 *
 * What this walk holds:
 *
 *   1. the figures are DERIVED from the log, not accumulated anywhere
 *   2. the wicket rule matches the bowling career's — a run out is nobody's
 *      wicket, and a run out at the far end is not this batter's dismissal
 *   3. byes are not the batter's runs, on either side of the delivery
 *   4. the matchup is SCOPED like every other aggregate here
 *   5. deliveries it cannot attribute are REPORTED, not silently dropped
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-matchups.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";

const PORT = 8828;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const HIL = "11111111-1111-1111-1111-111111111111";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-matchups-secret" },
  stdio: ["ignore", "pipe", "pipe"],
});
const serverErr = [];
server.stderr.on("data", (d) => serverErr.push(d.toString()));

const api = async (path, { token } = {}) => {
  const res = await fetch(BASE + path, {
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const login = async (email) => {
  const res = await fetch(`${BASE}/api/auth/dev-login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, deviceId: "device-matchups" }) });
  return (await res.json().catch(() => null))?.token;
};
const matchups = async (token, batterId) =>
  (await api(`/api/read/matchups?batterId=${batterId}`, { token })).body?.rows || [];

const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  const head   = await login("sarah@example.invalid");    // directorofsport
  const scorer = (await q(`select id from app_user where email = 'scorer@example.invalid'`))[0].id;
  // Three 1XI players: the batter, another batter at the far end, and the
  // bowler. A bowler needs a row here at all — see the coverage group below
  // for what happens to the ones who do not have one.
  // Scoped to Hilton deliberately. The first draft of this walk took the first
  // three 1XI players it found and got a bowler from ANOTHER SCHOOL — whom the
  // director of sport cannot read, so the matchup naming him correctly came
  // back empty and the walk looked broken. It was not: an aggregate that named
  // a player the reader may not see would be the leak this model exists to
  // prevent. The lesson stays as a comment because the failure looked exactly
  // like a bug in the query.
  const [bat, other, third] = await q(
    `select id, full_name from player
      where team_code = '1XI' and school_id = $1 order by full_name limit 3`, [HIL]);
  const bowl = (await q(
    `update player set bowling_style = 'Left-arm orthodox' where id = $1
      returning id, full_name, bowling_style`, [third.id]))[0];

  const m = (await q(
    `insert into match (school_id, team_code, opponent, starts_at, format, overs, status)
     values ($1,'1XI','Michaelhouse', now() - interval '3 days','T20',20,'complete') returning id`,
    [HIL]))[0].id;

  let seq = 0;
  const stamp = `${Date.now()}-${Math.random()}`;
  const ball = async ({ type = "run", value = 0, striker = bat.id, bowler = bowl.id,
                        dismissal = null, dismissed = null }) => {
    seq += 1;
    await q(
      `insert into ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
                               idempotency_key, client_seq, client_ts, kind, ball_type, value,
                               striker_id, bowler_id, dismissal, dismissed_id, payload)
       values ($1,$2,$3,1,0,$4,'device-matchups',$5,$3,now(),'ball',$6,$7,$8,$9,$10,$11,'{}'::jsonb)`,
      [m, HIL, seq, scorer, `mu-${stamp}-${seq}`, type, value, striker, bowler, dismissal, dismissed]);
  };

  // Eight legal deliveries plus a wide: 1,4,0,0,6,1,0 off the bat, one wicket.
  await ball({ value: 1 });
  await ball({ value: 4 });
  await ball({ value: 0 });
  await ball({ type: "Wd", value: 0 });          // no ball faced, no runs to him
  await ball({ value: 0 });
  await ball({ value: 6 });
  await ball({ type: "B", value: 2 });            // a bye: faced, but not his runs
  await ball({ value: 1 });
  await ball({ type: "W", value: 0, dismissal: "Bowled" });

  group("The matchup is counted off the log");
  const rows = await matchups(head, bat.id);
  const mu = rows.find((r) => r.bowler_id === bowl.id);
  ok("the pairing appears", !!mu);
  ok("both players are named", mu?.batter_name === bat.full_name && mu?.bowler_name === bowl.full_name);
  ok("the bowler's style rides along, which is what a coach plans against",
     mu?.bowling_style === "Left-arm orthodox");
  ok("a wide is not a ball faced", mu?.balls === 8);
  ok("runs off the bat only — the bye is not his", mu?.runs === 12);
  ok("boundaries are counted where they were hit", mu?.fours === 1 && mu?.sixes === 1);
  // Three: the two he blocked and the one he was out to. NOT the bye — that
  // delivery was worth two, and derivePhases counts dots the same way. The
  // walk pins the rule because "the batter scored nothing" is an equally
  // reasonable reading that would give four, and a matchup and a phase
  // breakdown disagreeing about one over is worse than either being arguable.
  ok("a dot is a legal delivery worth nothing, as the phase breakdown has it",
     mu?.dots === 3);
  ok("the dismissal is his", mu?.dismissals === 1);

  group("A run out is nobody's wicket, and not always this batter's dismissal");
  // The same rule player_bowling_career applies. Two failures are possible and
  // both are silent: crediting the bowler with a run out, and filing a far-end
  // run out against whoever happened to be on strike.
  await ball({ type: "W", value: 0, dismissal: "Run out", dismissed: bat.id });
  await ball({ type: "W", value: 0, dismissal: "Bowled", dismissed: other.id });
  const after = (await matchups(head, bat.id)).find((r) => r.bowler_id === bowl.id);
  ok("a run out is not credited to the bowler", after?.dismissals === 1);
  ok("...nor is a dismissal of the batter at the other end",
     after?.dismissals === 1 && after?.balls === 10);

  group("What the matchup cannot speak for, it says");
  // A bowler from a school SCRBRD does not host has no row, so the delivery
  // carries no bowler_id at all. Those balls are real and invisible here.
  await q(
    `insert into ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id, device_id,
                             idempotency_key, client_seq, client_ts, kind, ball_type, value,
                             striker_id, bowler_id, payload)
     values ($1,$2,$3,1,0,$4,'device-matchups',$5,$3,now(),'ball','run',3,$6,NULL,
             '{"bowler":"An away bowler"}'::jsonb)`,
    [m, HIL, ++seq, scorer, `mu-${stamp}-${seq}`, bat.id]);
  const cov = (await api(`/api/read/matchup_coverage?batterId=${bat.id}`, { token: head })).body?.rows?.[0];
  ok("the unattributable delivery is counted, not ignored", cov?.unattributable === 1);
  ok("...alongside the ones that could be attributed", cov?.attributable === 11);
  ok("...and they add up to every ball he faced", cov?.deliveries === 12);
  const still = (await matchups(head, bat.id)).find((r) => r.bowler_id === bowl.id);
  ok("the matchup itself did not quietly absorb it", still?.balls === 10);

  group("A matchup is an aggregate, and inherits the scope of the balls it counts");
  const spectator = await login("watcher@example.invalid");
  const specRows = await matchups(spectator, bat.id);
  const specBalls = specRows.reduce((a, r) => a + r.balls, 0);
  const headBalls = (await matchups(head, bat.id)).reduce((a, r) => a + r.balls, 0);
  ok("a spectator never sees more deliveries than the director of sport", specBalls <= headBalls);
  ok("an unauthenticated request is refused, not answered empty",
     [401, 403].includes((await api(`/api/read/matchups?batterId=${bat.id}`)).status));
  ok("...and so is the coverage that would describe it",
     [401, 403].includes((await api(`/api/read/matchup_coverage?batterId=${bat.id}`)).status));

  group("A batter nobody has bowled to has no matchups, rather than empty ones");
  const fresh = (await q(
    `insert into player (school_id, team_code, full_name, born)
     values ($1,'1XI','Never Faced', '2009-05-05') returning id`, [HIL]))[0].id;
  ok("no rows at all", (await matchups(head, fresh)).length === 0);
  ok("...and a coverage of nothing, which is not the same as no coverage",
     (await api(`/api/read/matchup_coverage?batterId=${fresh}`, { token: head }))
       .body?.rows?.[0]?.deliveries === 0);

} catch (e) {
  fail++; console.log("\n  ✗ threw:", e.message);
  if (serverErr.length) console.log(serverErr.join("").slice(-1500));
} finally {
  await pool.end().catch(() => {});
  server.kill();
  console.log("\n" + "─".repeat(52));
  console.log(`MATCHUPS SMOKE: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

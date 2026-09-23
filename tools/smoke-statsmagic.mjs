#!/usr/bin/env node
/**
 * Stats-Magic answers from figures, and still sends no child's name.
 *
 * services/api/ai/ai.test.mjs proves the arithmetic and the masking over rows
 * a test wrote. What it cannot prove is the half this walk exists for: that
 * /read/career, reached under a real principal against a real database, hands
 * contextFrom() the columns it thinks it is getting, and that the figures in
 * the built context are the figures the career views hold for the same reader.
 * A context built from a resource whose column names had drifted would read
 * perfectly and say "no record" about every boy in the school.
 *
 * NO MODEL CALL. `send` is injected here as it is in the unit suite: the
 * assertion is about the request that WOULD have gone to the provider, read
 * off the params the service built. Nothing in this file reaches the network.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-statsmagic.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";
import { statsMagicContext, askStatsMagic } from "../services/api/ai/ai-service.mjs";

const PORT = 8829;
const BASE = `http://127.0.0.1:${PORT}`;
const SECRET = "smoke-statsmagic-secret";
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${d}` : ""); } };
const group = (t) => console.log("\n" + t);

// The server is here only to mint a session the way a browser gets one. The
// context itself is built in this process, through the same readResource the
// /api/ai/stats route calls, so what is asserted is the service and not a
// second copy of it living in a walk.
const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: SECRET },
  stdio: ["ignore", "pipe", "pipe"],
});
const serverErr = [];
server.stderr.on("data", (d) => serverErr.push(d.toString()));

const login = async (email) => {
  const res = await fetch(`${BASE}/api/auth/dev-login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, deviceId: "device-statsmagic" }) });
  return (await res.json().catch(() => null))?.token;
};

const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;

try {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/api/health`).then((x) => x.json());
      if (r?.db === "ok") break;
    } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const head = await login("sarah@example.invalid");
  ok("a session to build the context under", Boolean(head));

  // The seed's ball log carries no bowler_id, so the bowling half of every
  // career view is empty on a fresh reset. A walk that only read the seed
  // would assert "no record" and call the bowling figures covered, so the
  // deliveries a bowler is charged with are written here — the same way
  // smoke-phases shapes an innings it needs.
  const m = (await q(`select id, school_id from match where status = 'complete' limit 1`))[0];
  const su = (await q(`select id from app_user where email = 'scorer@example.invalid'`))[0].id;
  const bowler = (await q(`select id, full_name from player where team_code = '1XI' order by full_name limit 1`))[0];
  const batter = (await q(`select id, full_name from player where team_code = '1XI' order by full_name desc limit 1`))[0];
  let seq = Number((await q(`select coalesce(max(seq), 0) as n from ball_event where match_id = $1`, [m.id]))[0].n);
  const stamp = `${Date.now()}-${Math.random()}`;
  const add = async (ball_type, value) => {
    seq += 1;
    await q(
      `insert into ball_event (match_id, school_id, seq, epoch, innings, scorer_user_id,
                               device_id, idempotency_key, client_seq, client_ts, kind,
                               ball_type, value, striker_id, bowler_id, payload)
       values ($1,$2,$3,1,2,$4,'device-statsmagic',$5,$3,now(),'ball',$6,$7,$8,$9,'{}'::jsonb)`,
      [m.id, m.school_id, seq, su, `sm-${stamp}-${seq}`, ball_type, value, batter.id, bowler.id]);
  };
  for (let i = 0; i < 24; i++) await add("run", i % 4 === 0 ? 4 : 1);
  await add("Wd", 0);
  await add("Nb", 0);

  const ctx = await statsMagicContext(pool, SECRET, `Bearer ${head}`);

  group("The context carries figures, not just a roster");
  ok("the roster is still there", /^Players: /.test(ctx.context), ctx.context.slice(0, 60));
  ok("...and career figures with it", /Career figures, from the deliveries this user may read:/.test(ctx.context));
  ok("a strike rate is in the context at all", /SR \d+\.\d/.test(ctx.context));
  ok("...and an economy rate", /economy \d+\.\d\d/.test(ctx.context));

  group("The figures are the figures the career views hold");
  // The same reader, the same views, read directly. Two authoritative-looking
  // numbers that disagree is the failure this asserts against.
  const [bat] = await q(
    `select b.matches, b.runs, b.balls_faced, b.fours, b.sixes,
            coalesce(d.dismissals, 0) as dismissals
       from player_batting_career b
       left join player_dismissals d on d.player_id = b.player_id
      where b.player_id = $1`, [batter.id]);
  const [bowl] = await q(
    `select matches, runs_conceded, legal_balls, wickets from player_bowling_career where player_id = $1`,
    [bowler.id]);
  ok("the seeded batter has a real batting record to compare against", Boolean(bat) && bat.runs > 0);
  ok("the bowler has a real bowling record", Boolean(bowl) && bowl.legal_balls > 0);

  const sr = (100 * Number(bat.runs) / Number(bat.balls_faced)).toFixed(1);
  const avg = Number(bat.dismissals) > 0 ? (Number(bat.runs) / Number(bat.dismissals)).toFixed(2) : null;
  const econ = (6 * Number(bowl.runs_conceded) / Number(bowl.legal_balls)).toFixed(2);
  const matchesWord = (n) => `${n} ${Number(n) === 1 ? "match" : "matches"}`;
  const batLine = new RegExp(`${batter.full_name} — batting: ${matchesWord(bat.matches)}, ${bat.runs} runs off ${bat.balls_faced} balls, SR ${sr}, ${
    avg ? `average ${avg}` : "no average \\(never dismissed\\)"}, ${bat.fours}x4 ${bat.sixes}x6`);
  ok("the batter's line is the view's own counts and the ratio they imply",
     batLine.test(ctx.context), ctx.context.match(new RegExp(`${batter.full_name} — batting:[^;]*`))?.[0]);
  ok("...and the bowler's economy is charged runs over the legal balls, not over deliveries",
     new RegExp(`${bowl.runs_conceded} runs off ${bowl.legal_balls} legal balls, economy ${econ}`).test(ctx.context),
     ctx.context.match(new RegExp(`${bowler.full_name} — batting:[^.]*`))?.[0]);
  // A wide is not a ball faced and a no-ball is; both are charged to the
  // bowler and neither is a legal ball. If the view and the line disagree
  // about that the arithmetic above still matches and the cricket is wrong.
  ok("a wide and a no-ball are not legal balls", Number(bowl.legal_balls) === 24);

  group("A boy with nothing in the log is not a boy who averages nothing");
  const quiet = (await q(
    `select p.full_name from player p
      where not exists (select 1 from player_batting_career b where b.player_id = p.id)
        and not exists (select 1 from player_bowling_career w where w.player_id = p.id)
        and p.school_id = $1
      order by p.full_name limit 1`, [m.school_id]))[0];
  ok("the seed has such a boy", Boolean(quiet?.full_name));
  ok("he is named as having nothing recorded",
     new RegExp(`Nothing recorded yet in the ball log for:[^.]*${quiet.full_name}`).test(ctx.context));
  ok("...and never appears with a figure of zero",
     !new RegExp(`${quiet.full_name} — batting`).test(ctx.context));

  group("No child's name reaches the provider, figures or not");
  let sent = null;
  const send = async (params) => { sent = params; return { content: [{ type: "text", text: "PLAYER_1." }] }; };
  await askStatsMagic({ question: `What is ${batter.full_name}'s strike rate this term?`, ...ctx, send });
  const everyName = (await q(`select full_name from player`)).map((r) => r.full_name).filter(Boolean);
  const leaked = everyName.filter((n) => JSON.stringify(sent).includes(n));
  ok(`none of the ${everyName.length} names in the database is in the request`, leaked.length === 0, leaked.join(", "));
  ok("the figures are there, against a token", /PLAYER_\d+ — batting: \d+ match(es)?, \d+ runs/.test(sent.system),
     sent?.system?.slice(-200));
  ok("...and so is the boy with no record", /Nothing recorded yet in the ball log for: PLAYER_\d+/.test(sent.system));

  group("No session, no figures");
  const refused = await statsMagicContext(pool, SECRET, undefined).catch((e) => e);
  ok("an unauthenticated build is refused before any read", [401, 403].includes(refused?.status),
     String(refused?.status ?? refused?.message));

} catch (e) {
  fail++; console.log("\n  ✗ threw:", e.message);
  if (serverErr.length) console.log(serverErr.join("").slice(-1200));
} finally {
  await pool.end().catch(() => {});
  server.kill();
  console.log("\n" + "─".repeat(52));
  console.log(`STATS-MAGIC SMOKE: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

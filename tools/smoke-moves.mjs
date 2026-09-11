#!/usr/bin/env node
/**
 * Moving a boy between sides WITH A DATE, and reading a side as it stood.
 *
 * team_membership (see tools/smoke-membership.mjs, which proves the table)
 * recorded every move as of the day it was typed. A decision made on Saturday
 * and entered on Tuesday was three days wrong, and the seed's first
 * memberships all began on the demo's birthday. There was also no route: a
 * boy's side changed through the CSV import or not at all.
 *
 *   1. A MOVE HAS A DATE. In the past when it was recorded late; never in the
 *      future, because this table records what happened, not plans.
 *   2. IT CANNOT REACH BEFORE THE SIDE IT CLOSES — two sides true at once.
 *   3. THE ROUTE WRITES THE COLUMN, ONLY. The history row is the trigger's,
 *      exactly as it is for the import — one door, not two.
 *   4. WHO WAS IN THE SIDE ON A DATE is a read, not a reconstruction by hand.
 *   5. THE SEED DATES THE SEASON'S SIDES TO WHEN THEY WERE NAMED.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-moves.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";

const PORT = 8861;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const HIL = "11111111-1111-1111-1111-111111111111";
const SEASON_START = "2026-01-15";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-moves-secret" },
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
  method: "POST", body: { email, deviceId: "device-moves" } })).body?.token;
const move = (id, token, body) => api(`/api/players/${id}/team`, { method: "POST", token, body });
const rosterOn = async (team, on, token) =>
  (await api(`/api/read/roster_on?schoolId=${HIL}&teamCode=${team}&on=${on}`, { token })).body?.rows ?? [];
const spells = (id) => q(`select team_code, joined_on::text j, left_on::text l, reason, moved_by
                             from team_membership where player_id = $1 and sport = 'cricket'
                            order by joined_on, created_at`, [id]);

const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;
const today = new Date().toISOString().slice(0, 10);

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  const head    = await login("sarah@example.invalid");     // directorofsport: player.profile.manage
  const coach   = await login("coach@example.invalid");     // 1XI
  const watcher = await login("watcher@example.invalid");
  const parent  = await login("parent@example.invalid");
  const idOf = async (email) => (await q(`select id from app_user where email = $1`, [email]))[0].id;

  group("The season's sides are dated to when they were named");
  {
    // The seed hands the trigger an effective date through the same channel
    // the route uses. Without it every first membership began on whatever day
    // the seed happened to run.
    const dates = await q(`select distinct joined_on::text d from team_membership`);
    ok("every seeded membership begins on the season start",
       dates.length === 1 && dates[0].d === SEASON_START);
  }

  // Any Hilton boy not already in the 1XI, whatever side the seed has him in —
  // chosen rather than assumed. The first draft wanted a 2XI boy and there is
  // no 2XI in the seed.
  const boy = (await q(`select id, full_name, team_code from player
                         where school_id = $1 and team_code is not null and team_code <> '1XI'
                         order by team_code, full_name limit 1`, [HIL]))[0];
  ok("there is a boy outside the 1XI to promote", !!boy);
  const FROM = boy?.team_code;

  group("A move has a date, and it can be in the past");
  {
    const r = await move(boy.id, head, { teamCode: "1XI", effectiveOn: "2026-03-01" });
    ok("the director of sport can move him", r.status === 200);
    ok("...and is told when it took effect", String(r.body?.effectiveOn).slice(0, 10) === "2026-03-01");
    ok("...and where he came from, and when he left it",
       r.body?.previous?.teamCode === FROM && String(r.body?.previous?.leftOn).slice(0, 10) === "2026-03-01");
    const s = await spells(boy.id);
    ok("his old side's spell closed on the move date, not today", s[0]?.team_code === FROM && s[0]?.l === "2026-03-01");
    ok("the 1XI spell opened on it", s[1]?.team_code === "1XI" && s[1]?.j === "2026-03-01" && s[1]?.l === null);
    ok("the column agrees", (await q(`select team_code from player where id = $1`, [boy.id]))[0].team_code === "1XI");
    // The route wrote nothing to team_membership itself — the stamp on the
    // row is the trigger's, from the session, and it names the mover.
    ok("the row is stamped with the mover", s[1]?.moved_by === await idOf("sarah@example.invalid"));
    ok("...and the vocabulary is the trigger's, not the caller's", s[1]?.reason === "moved");
  }

  group("It cannot reach before the side it closes, and never into the future");
  {
    const early = await move(boy.id, head, { teamCode: FROM, effectiveOn: "2026-02-01" });
    ok("a backdate before his current side began is refused", early.status === 422);
    ok("...naming the date it collided with", /2026-03-01/.test(early.body?.detail ?? ""));
    ok("...and nothing changed", (await spells(boy.id)).length === 2
       && (await q(`select team_code from player where id = $1`, [boy.id]))[0].team_code === "1XI");
    ok("a future date is refused", (await move(boy.id, head, { teamCode: FROM, effectiveOn: "2999-01-01" })).status === 400);
    ok("a non-date is refused", (await move(boy.id, head, { teamCode: FROM, effectiveOn: "next Tuesday" })).status === 400);
    ok("a side has to be named", (await move(boy.id, head, {})).status === 400);
    // Undated means today — the ordinary case, a move typed on the day.
    // Back to where he started, undated: the ordinary case, typed on the day.
    const now = await move(boy.id, head, { teamCode: FROM });
    ok("an undated move is dated today", now.status === 200 && String(now.body?.effectiveOn).slice(0, 10) === today);
    // Same-day arrivals and departures are legitimate: a side named and
    // changed on one Saturday morning.
    ok("...closing the previous spell today too",
       String(now.body?.previous?.leftOn).slice(0, 10) === today);
  }

  group("Who was in the side on a date");
  {
    ok("in February he was in his old side", (await rosterOn(FROM, "2026-02-01", head)).some((r) => r.player_id === boy.id));
    ok("...and not in the 1XI",              !(await rosterOn("1XI", "2026-02-01", head)).some((r) => r.player_id === boy.id));
    ok("in March he was in the 1XI",         (await rosterOn("1XI", "2026-03-15", head)).some((r) => r.player_id === boy.id));
    ok("...and not in his old side",         !(await rosterOn(FROM, "2026-03-15", head)).some((r) => r.player_id === boy.id));
    ok("today he is back in his old side",   (await rosterOn(FROM, today, head)).some((r) => r.player_id === boy.id));
    ok("...and not in the 1XI any more",     !(await rosterOn("1XI", today, head)).some((r) => r.player_id === boy.id));
    ok("before the season there was no side at all", (await rosterOn("1XI", "2026-01-01", head)).length === 0);
    // The question the column could never answer: two different XIs.
    const feb = (await rosterOn("1XI", "2026-02-01", head)).map((r) => r.player_id).sort();
    const mar = (await rosterOn("1XI", "2026-03-15", head)).map((r) => r.player_id).sort();
    ok("the 1XI in February and the 1XI in March are different sides", JSON.stringify(feb) !== JSON.stringify(mar) && mar.length === feb.length + 1);
    ok("the read is scoped like the roster: a spectator sees no side on any date",
       (await rosterOn("1XI", "2026-03-15", watcher)).length === 0);
    ok("...and a coach sees only his own side's",
       (await rosterOn("1XI", "2026-03-15", coach)).length > 0
       && (await rosterOn(FROM, "2026-02-01", coach)).length === 0);
  }

  group("Who may move him");
  {
    for (const [who, tok] of [["a coach", coach], ["a spectator", watcher], ["a guardian", parent]]) {
      ok(`${who} cannot move a boy`, [403, 401].includes((await move(boy.id, tok, { teamCode: "1XI" })).status));
    }
    ok("...and nothing changed", (await spells(boy.id)).length === 3);
  }

} catch (e) {
  fail++; console.log("\n  ✗ threw:", e.message);
  if (serverErr.length) console.log(serverErr.join("").slice(-1500));
} finally {
  await pool.end().catch(() => {});
  server.kill();
  console.log("\n" + "─".repeat(52));
  console.log(`MOVES SMOKE: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

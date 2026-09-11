#!/usr/bin/env node
/**
 * Where a boy has played, which the schema was overwriting.
 *
 * player.team_code is the scope anchor and stays the CURRENT side; what was
 * missing was everything before it. A boy promoted 2XI→1XI in March was
 * overwritten, not recorded — and the CSV import moves team_code today, so
 * this was active data loss through a real route, not a future hazard.
 *
 *   1. THE HISTORY IS DERIVED, NEVER ASSERTED. Writing player.team_code
 *      writes it, through a trigger, whichever of the three ways in the write
 *      came — the API, a seed, the import.
 *   2. NOBODY CAN FORGE OR EDIT IT. The table has no write policy at all.
 *   3. LAST SEASON'S SIDE CAN BE RECONSTRUCTED, which is the question the
 *      table exists to answer.
 *   4. READ FOLLOWS THE BOY. The coach who may read him may read the rows
 *      that explain him; a guardian gets their own child's and no other's.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-membership.mjs
 */
import { spawn } from "node:child_process";
import pg from "pg";

const PORT = 8861;
const BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const HIL = "11111111-1111-1111-1111-111111111111";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const server = spawn(process.execPath, ["services/api/server.mjs"], {
  env: { ...process.env, PORT: String(PORT), NODE_ENV: "development",
         ALLOW_DEV_LOGIN: "1", SESSION_SECRET: "smoke-membership-secret" },
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
  method: "POST", body: { email, deviceId: "device-membership" } })).body?.token;
const history = async (playerId, token) =>
  (await api(`/api/read/memberships?playerId=${playerId}`, { token })).body?.rows ?? [];

const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;

/** One statement under a person's own policies, rolled back. The id is
 *  resolved BEFORE the role switch — the smoke-fixture walk earned that
 *  lesson: resolved inside, the subselect runs with no principal, sets the
 *  principal to nobody, and every assertion passes by seeing zero rows. */
async function asPerson(email, sql, params = []) {
  const { rows: who } = await pool.query(`select id from app_user where email = $1`, [email]);
  const id = who[0]?.id ?? null;
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL ROLE scrbrd_app");
    await c.query("SELECT set_config('app.user_id', $1, true)", [id]);
    const r = await c.query(sql, params);
    await c.query("ROLLBACK");
    return { ok: true, rows: r.rows, count: r.rowCount };
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    return { ok: false, code: e.code, message: e.message };
  } finally { c.release(); }
}

try {
  for (let i = 0; i < 60; i++) {
    try { const r = await api("/api/health"); if (r.body?.db === "ok") break; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 250));
  }

  const coach   = await login("coach@example.invalid");     // 1XI
  const coach2  = await login("coach2@example.invalid");    // 2XI
  const parent  = await login("parent@example.invalid");    // guardian of R Pillay
  const head    = await login("sarah@example.invalid");
  const CHILD   = "aaaaaaaa-0000-0000-0000-000000000005";   // R Pillay, 1XI

  group("Every seeded boy already has a first chapter");
  {
    const n = (await q(`select count(*)::int c from team_membership where reason='joined'`))[0].c;
    const p = (await q(`select count(*)::int c from player where team_code is not null`))[0].c;
    // The trigger fired for the seed itself — the seed is one of the three
    // ways a player row is written, and it must not be the exempt one.
    ok("one opening membership per rostered player", n === p && n > 0);
    ok("...every one of them open",
       (await q(`select count(*)::int c from team_membership where left_on is not null`))[0].c === 0);
  }

  group("A promotion is recorded, not overwritten");
  {
    const boy = (await q(`select id, team_code from player
                           where school_id = $1 and team_code = 'U16B' limit 1`, [HIL]))[0];
    ok("there is a U16B boy to promote", !!boy);
    await q(`update player set team_code = '1XI' where id = $1`, [boy.id]);
    const rows = await q(`select team_code, joined_on, left_on, reason from team_membership
                           where player_id = $1 order by created_at`, [boy.id]);
    ok("the move produced a second chapter", rows.length === 2);
    ok("...the old side is closed, not gone",
       rows[0].team_code === "U16B" && rows[0].left_on !== null);
    ok("...the new side is open", rows[1].team_code === "1XI" && rows[1].left_on === null);
    ok("...and says it was a move, not a joining", rows[1].reason === "moved");
    ok("player.team_code still answers for the present",
       (await q(`select team_code from player where id = $1`, [boy.id]))[0].team_code === "1XI");

    // A write that does not touch the side writes no history. Without this,
    // correcting a hometown would fill the table with phantom moves.
    const before = (await q(`select count(*)::int c from team_membership where player_id=$1`, [boy.id]))[0].c;
    await q(`update player set hometown = 'Howick' where id = $1`, [boy.id]);
    ok("an unrelated correction adds nothing",
       (await q(`select count(*)::int c from team_membership where player_id=$1`, [boy.id]))[0].c === before);
  }

  group("The import writes history too, because it is a way in");
  {
    // The route that made this urgent: the CSV import updates team_code with
    // coalesce, so every bulk roster correction was silently discarding where
    // boys were.
    // U13A, because the seed's Hilton sides are 1XI, U16B and U13A — a first
    // draft assumed a 2XI that does not exist and fell over on undefined.
    const boy = (await q(`select p.id, p.full_name, p.team_code from player p
                           where p.school_id = $1 and p.team_code = 'U13A' limit 1`, [HIL]))[0];
    ok("there is a U13A boy for the office to move", !!boy);
    const csv = `full_name,team_code\n"${boy.full_name}",1XI\n`;
    const r = await api("/api/import/players", { method: "POST", token: await login("registrar@example.invalid"),
      body: { schoolId: HIL, csv, commit: true } });
    ok("the import ran and updated him", r.status === 200 && r.body?.updated === 1);
    const rows = await q(`select team_code, left_on from team_membership
                           where player_id = $1 order by created_at`, [boy.id]);
    ok("...and the bulk move is a chapter like any other",
       rows.length === 2 && rows[0].team_code === "U13A" && rows[0].left_on !== null
       && rows[1].team_code === "1XI" && rows[1].left_on === null);
    ok("...with the office's registrar on it",
       (await q(`select m.moved_by, u.email from team_membership m
                  left join app_user u on u.id = m.moved_by
                  where m.player_id = $1 and m.left_on is null`, [boy.id]))[0]
         ?.email === "registrar@example.invalid");
  }

  group("Nobody can forge or edit the record");
  {
    const forge = await asPerson("sarah@example.invalid",
      `insert into team_membership (player_id, school_id, team_code, joined_on)
       values ($1, $2, '1XI', '2024-01-01')`, [CHILD, HIL]);
    // Not even the director of sport: the table has no INSERT policy, so a
    // hand-written chapter — "he was in the 1XI in 2024" — cannot exist.
    ok("a membership cannot be written by hand", !forge.ok && forge.code === "42501");
    const edit = await asPerson("sarah@example.invalid",
      `update team_membership set joined_on = '2020-01-01' where player_id = $1`, [CHILD]);
    ok("...nor edited once it exists", (!edit.ok && edit.code === "42501") || (edit.ok && edit.count === 0));
    ok("...and nothing changed",
       (await q(`select count(*)::int c from team_membership
                  where player_id = $1 and joined_on < current_date`, [CHILD]))[0].c === 0);
  }

  group("Last season's side can be reconstructed");
  {
    // THE QUESTION THE TABLE EXISTS TO ANSWER. Backdate a plausible history
    // as the migration owner — the one principal allowed to, because restoring
    // a paper archive is a migration — then ask who the 1XI were on a date.
    const boys = await q(`select id from player where school_id = $1 and team_code = '1XI'
                           order by full_name limit 2`, [HIL]);
    await q(`update team_membership set joined_on = '2025-09-01'
              where player_id = any($1::uuid[]) and left_on is null`, [boys.map(b => b.id)]);
    await q(`insert into team_membership (player_id, school_id, team_code, joined_on, left_on, reason)
             values ($1, $2, '2XI', '2024-09-01', '2025-08-31', 'joined')`, [boys[0].id, HIL]);
    const asOf = async (date) => (await q(
      `select m.player_id, m.team_code from team_membership m
        where m.school_id = $1 and m.joined_on <= $2::date
          and (m.left_on is null or m.left_on >= $2::date)
          and m.team_code = '2XI'`, [HIL, date]));
    ok("in June 2025 he was a 2XI player", (await asOf('2025-06-01')).some((r) => r.player_id === boys[0].id));
    ok("...and by October he was not",
       !(await asOf('2025-10-01')).some((r) => r.player_id === boys[0].id));
  }

  group("Read follows the boy");
  {
    // Give R Pillay a past side so there is history to be read.
    await q(`update player set team_code = 'U16B' where id = $1`, [CHILD]);
    await q(`update player set team_code = '1XI'  where id = $1`, [CHILD]);
    const mine = await history(CHILD, coach);
    ok("his 1XI coach reads his whole story", mine.length >= 3);
    ok("...including the sides that are not the coach's",
       mine.some((r) => r.team_code === "U16B" && r.left_on !== null));
    ok("...with exactly one current side", mine.filter((r) => r.current).length === 1);
    // The anchor is the boy's CURRENT team. He is 1XI now, so his history is
    // the 1XI coach's to read and not the 2XI coach's — access moved with him.
    ok("a coach of another side reads none of it", (await history(CHILD, coach2)).length === 0);
    ok("a guardian reads their own child's", (await history(CHILD, parent)).length >= 3);
    const others = (await q(`select id from player where school_id = $1 and id <> $2
                              and team_code is not null limit 1`, [HIL, CHILD]))[0];
    ok("...and no other family's", (await history(others.id, parent)).length === 0);
    ok("the director of sport reads the school's", (await history(CHILD, head)).length >= 3);
  }

} catch (e) {
  fail++; console.log("\n  ✗ threw:", e.message);
  if (serverErr.length) console.log(serverErr.join("").slice(-1500));
} finally {
  await pool.end().catch(() => {});
  server.kill();
  console.log("\n" + "─".repeat(52));
  console.log(`MEMBERSHIP SMOKE: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

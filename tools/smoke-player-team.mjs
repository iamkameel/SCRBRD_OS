#!/usr/bin/env node
/**
 * db/108 and its fix file, run the way Kameel will run them (REACH-D4).
 *
 * db/99 §85 proves the constraint and the doors on a database that already
 * has db/108. It cannot prove what db/108 does to a database that does NOT
 * have it yet and still holds a team-less `player` role — which is exactly
 * production and the demo database on 14 October 2026 (the seeded test
 * account spectator@example.invalid). This walk rebuilds that state inside
 * one transaction, as the owner, and pastes the real files into it:
 *
 *   1. db/108, with a live team-less `player` row on the record: refused by
 *      name, the count and the account in the message, nothing changed
 *   2. tools/sql/fix-player-without-team.sql refuses, changing nothing, when
 *      the team-less row is another account's, or the named account is a
 *      pupil on the roster
 *   3. the fix file ends the seeded account's row (kept, active = false,
 *      revoked_at stamped), and a second paste finds nothing to do
 *   4. db/108 then runs, and the constraint is validated
 *
 * Everything is rolled back at the end; the database is left as it was.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-player-team.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { ownerUrl } from "./db-url.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DB108 = readFileSync(join(ROOT, "db", "108_player_team_scoped.sql"), "utf8");
const FIX = readFileSync(join(ROOT, "tools", "sql", "fix-player-without-team.sql"), "utf8");
const SPECTATOR = "88888888-0000-0000-0000-000000000001";   // the seeded test account
const WATCHER   = "88888888-0000-0000-0000-000000000008";   // a genuine spectator: another account
const HIL       = "11111111-1111-1111-1111-111111111111";
const P_PILLAY  = "aaaaaaaa-0000-0000-0000-000000000005";   // a pupil on the roster

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) pass++; else { fail++; console.log("  ✗", n, extra ?? ""); } };
const group = (t) => console.log("\n" + t);

const client = new pg.Client({ connectionString: ownerUrl() });
const notices = [];
client.on("notice", (m) => notices.push(m.message));
const q = async (t, p) => (await client.query(t, p)).rows;
/** Run a whole file; answer the error's message, or null. */
const paste = async (text) => {
  await client.query("SAVEPOINT paste");
  try { await client.query(text); await client.query("RELEASE SAVEPOINT paste"); return null; }
  catch (e) { await client.query("ROLLBACK TO SAVEPOINT paste"); return String(e.message); }
};
const constraint = async () => (await q(`select convalidated from pg_constraint
  where conrelid = 'role_assignment'::regclass and conname = 'role_assignment_player_team_scoped'`))[0] ?? null;
const teamless = async () => (await q(`select a.id, a.person_id, a.active, a.revoked_at from role_assignment a
  where a.role = 'player' and a.team_code is null order by a.created_at, a.id`));

try {
  await client.connect();
  await client.query("BEGIN");

  group("The database as production held it on 14 October: no constraint, one team-less pupil role");
  ok("db/108 is applied here to begin with", (await constraint())?.convalidated === true);
  await client.query("ALTER TABLE role_assignment DROP CONSTRAINT role_assignment_player_team_scoped");
  const [{ id: row }] = await q(`insert into role_assignment (person_id, role, school_id, team_code)
                                 values ($1, 'player', $2, null) returning id`, [SPECTATOR, HIL]);
  ok("the team-less row is on the record, live", (await teamless()).some((r) => r.id === row && r.active));

  group("1 · db/108 refuses, by name, and changes nothing");
  {
    const e = await paste(DB108);
    ok("refused", e !== null);
    ok("...with the count and the account", /db\/108: 1 live player assignment\(s\)/.test(e ?? "") && (e ?? "").includes("spectator@example.invalid"), e);
    ok("...and says to paste the fix file first", (e ?? "").includes("tools/sql/fix-player-without-team.sql"));
    ok("no constraint was added", (await constraint()) === null);
    ok("the row is untouched", (await teamless()).some((r) => r.id === row && r.active));
  }

  group("2 · The fix file refuses what it was not approved for");
  {
    await client.query("SAVEPOINT other");
    await q(`insert into role_assignment (person_id, role, school_id, team_code) values ($1, 'player', $2, null)`, [WATCHER, HIL]);
    const e = await paste(FIX);
    ok("another account's team-less row: refused", /not approved for/.test(e ?? ""), e);
    ok("...and nothing was ended", (await teamless()).filter((r) => r.active).length === 2);
    await client.query("ROLLBACK TO SAVEPOINT other");

    await client.query("SAVEPOINT pupil");
    await q(`update app_user set player_id = $2 where id = $1`, [SPECTATOR, P_PILLAY]);
    const e2 = await paste(FIX);
    ok("the named account linked to a pupil on the roster: refused", /is a pupil's account/.test(e2 ?? ""), e2);
    ok("...and nothing was ended", (await teamless()).some((r) => r.id === row && r.active));
    await client.query("ROLLBACK TO SAVEPOINT pupil");
  }

  group("3 · The fix file ends the seeded account's row, and only that");
  {
    const before = (await q(`select count(*)::int c from role_assignment where active`))[0].c;
    notices.length = 0;
    const e = await paste(FIX);
    ok("it ran", e === null, e);
    ok("...and said what it ended", notices.some((n) => /ended 1 team-less player role/.test(n)), notices.join(" | "));
    const [r] = await q(`select active, revoked_at, team_code from role_assignment where id = $1`, [row]);
    ok("the row is kept, ended, with the time", r && r.active === false && r.revoked_at !== null && r.team_code === null);
    ok("nothing else was ended", (await q(`select count(*)::int c from role_assignment where active`))[0].c === before - 1);
    notices.length = 0;
    ok("a second paste changes nothing", (await paste(FIX)) === null && notices.some((n) => /nothing to do/.test(n)), notices.join(" | "));
  }

  group("4 · db/108 then runs");
  {
    const e = await paste(DB108);
    ok("it ran", e === null, e);
    ok("the constraint is there and validated", (await constraint())?.convalidated === true);
    ok("the ended row stands beside it, as history", (await teamless()).some((r) => r.id === row && !r.active));
    const e2 = await paste(`insert into role_assignment (person_id, role, school_id, team_code) values ('${SPECTATOR}', 'player', '${HIL}', null)`);
    ok("a new team-less pupil role is refused", /role_assignment_player_team_scoped/.test(e2 ?? ""), e2);
    ok("a second paste of db/108 changes nothing", (await paste(DB108)) === null);
  }
} catch (e) {
  fail++;
  console.log("  ✗ walk error:", e.message);
} finally {
  await client.query("ROLLBACK").catch(() => {});
  await client.end().catch(() => {});
}

console.log("\n" + "─".repeat(52));
console.log(`PLAYER TEAM: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

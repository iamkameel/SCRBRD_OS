#!/usr/bin/env node
/**
 * A LOCAL REPLICA of the DEMO copy (scrbrd-demo), for rehearsing a paste
 * before the lead makes it there. Never the demo itself: it refuses any
 * database not on this machine.
 *
 *   SCRBRD_DB=demo_season SCRBRD_DB_PORT=5433 node tools/migrate.mjs --reset --seed
 *   SCRBRD_DB=demo_season SCRBRD_DB_PORT=5433 node tools/demo-replica.mjs
 *
 * On top of the seed it builds what the demo holds, at the demo's ids:
 *
 *   - Kearsney College (KEA, 3333…) and its office, office.kea@ (88888888-…-ea)
 *   - the 330 invented players at de300000-0000-4000-8000-000000000NNN, in the
 *     demo's sides, squad numbers, roles and birth years (tools/demo-roster.mjs),
 *     with NAMES INVENTED HERE (never the demo's), and each side's membership
 *   - a verified, consenting guardian for each, parent.NNN@example.invalid at
 *     de300000-0000-4000-9000-000000000NNN, verified by the school's office
 *   - the seed's four Hilton fixtures moved to the dates the demo holds
 *     (its seed ran on 7 Oct; a seed run today would date them from today)
 *   - the solo-test cast, by running tools/demo-cast.mjs's own SQL, then its
 *     "today" 1XI fixture moved to 7 Oct 19:00 SAST, the day the demo's ran
 *
 * Every person is invented and every address @example.invalid.
 */
import { writeFileSync, readFileSync, mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { ownerUrl } from "./db-url.mjs";
import { ROSTER, WES, KEA } from "./demo-roster.mjs";

const url = new URL(ownerUrl());
if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
  console.error("✗ refusing: the replica is built on a database on this machine only.");
  process.exit(2);
}
const pool = new pg.Pool({ connectionString: ownerUrl() });
const q = async (t, p) => (await pool.query(t, p)).rows;

if ((await q(`select 1 from school where id = $1`, [KEA])).length) {
  console.error("✗ Kearsney is already here: the replica is built once, on a freshly seeded database.");
  await pool.end(); process.exit(2);
}

// ── Invented names: a first-name list and syllable-built surnames ──
const FIRST = ["Aidan", "Bandile", "Caleb", "Dineo", "Ethan", "Fezile", "Gareth", "Hlumelo", "Ivan", "Jared", "Kagiso", "Liam",
  "Musa", "Nathan", "Owethu", "Pieter", "Qhawe", "Reece", "Sipho", "Tyler", "Unathi", "Vusi", "Wade", "Xolani", "Yusuf", "Zane",
  "Ayanda", "Brandon", "Connor", "Dylan", "Lwazi", "Kyle", "Marco", "Nkosi", "Rohan", "Thabo", "Keegan", "Jaden", "Luthando", "Ruan"];
const SYL_A = ["Bra", "Cal", "Dre", "Fen", "Gol", "Hav", "Kel", "Lum", "Mor", "Nes", "Pel", "Quin", "Ros", "Sel", "Tav", "Vor", "Wex", "Yar", "Zim", "Ost"];
const SYL_B = ["dane", "wick", "holm", "tari", "vello", "mire", "ston", "ruth", "baya", "lowe", "nder", "kirk", "sana", "dell", "more", "vane"];
const surnameOf = (n) => SYL_A[(n * 7) % SYL_A.length] + SYL_B[(n * 11 + Math.floor(n / 20)) % SYL_B.length];
const firstOf = (n) => FIRST[(n * 13) % FIRST.length];
const ADULT = ["Anne", "Brian", "Carol", "David", "Esther", "Frank", "Grace", "Henry", "Irene", "James", "Karen", "Lerato", "Mandla", "Nomsa", "Owen", "Precious"];

const OFFICE = { [WES]: "88888888-0000-0000-0000-00000000000d", [KEA]: "88888888-0000-0000-0000-0000000000ea" };
const parentId = (n) => `de300000-0000-4000-9000-${String(n).padStart(12, "0")}`;

const client = await pool.connect();
try {
  await client.query("begin");
  await client.query(`insert into school (id, code, name, kind, province, created_at)
                      values ($1, 'KEA', 'Kearsney College', 'school', 'KwaZulu-Natal', '2026-10-07 15:47:43+00')`, [KEA]);
  await client.query(`insert into app_user (id, school_id, email, name, role) values ($1, $2, 'office.kea@example.invalid', 'K Office', 'schooladmin')`,
                     [OFFICE[KEA], KEA]);
  await client.query(`insert into role_assignment (id, person_id, role, school_id) values ('de300000-0000-4000-b000-000000000001', $1, 'schooladmin', $2)`,
                     [OFFICE[KEA], KEA]);
  for (const b of ROSTER) {
    const sur = surnameOf(b.n), first = firstOf(b.n);
    await client.query(
      `insert into player (id, school_id, team_code, full_name, surname, squad_no, playing_role, batting_style, bowling_arm, bowling_style, born)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, make_date($11, 1 + ($12 % 12), 1 + ($12 % 27)))`,
      [b.id, b.school, b.team, `${first} ${sur}`, sur, b.squad, b.role, b.bat, b.arm, b.bowl, b.year, b.n]);
    // The player's insert opens his side's membership itself (db/…); dated as the demo's.
    await client.query(`update team_membership set joined_on = date '2026-10-07', reason = 'joined' where player_id = $1`, [b.id]);
    const gid = parentId(b.n);
    await client.query(`insert into app_user (id, school_id, email, name, role) values ($1, $2, $3, $4, 'guardian')`,
                       [gid, b.school, `parent.${String(b.n).padStart(3, "0")}@example.invalid`, `${ADULT[b.n % ADULT.length]} ${sur}`]);
    const [ra] = (await client.query(`insert into role_assignment (person_id, role, school_id) values ($1, 'guardian', $2) returning id`,
                                     [gid, b.school])).rows;
    await client.query(
      `insert into assignment_subject (assignment_id, player_id, relationship, verification_state, verified_by, verified_at,
                                       consent_state, consent_version, consent_at, valid_from, created_by)
       values ($1, $2, 'parent', 'verified', $3, timestamptz '2026-10-07 15:47:43+00', 'granted', 'popia-2026-01',
               timestamptz '2026-10-07 15:47:43+00', date '2026-10-07', $3)`, [ra.id, b.id, OFFICE[b.school]]);
  }
  // The seed's Hilton fixtures, at the dates the demo's seed gave them.
  for (const [n, at] of [[1, "2026-09-30T15:46:32Z"], [2, "2026-10-10T15:46:32Z"], [3, "2026-10-17T15:46:32Z"], [4, "2026-09-23T15:46:32Z"]]) {
    await client.query(`update match set starts_at = $2 where id = $1`, [`77777777-0000-0000-0000-00000000000${n}`, at]);
  }
  await client.query("commit");
} catch (e) { await client.query("rollback"); throw e; } finally { client.release(); }
console.log(`✓ Kearsney, ${ROSTER.length} invented players and their guardians`);

// ── The solo-test cast, exactly as the demo got it ──
const dir = mkdtempSync(join(tmpdir(), "demo-replica-"));
const castFile = join(dir, "demo-cast.sql");
execFileSync(process.execPath, ["tools/demo-cast.mjs", castFile], { stdio: "inherit" });
await pool.query(readFileSync(castFile, "utf8"));
// Its "today" 1XI fixture was 7 October on the demo, at 19:00 SAST.
const moved = await q(
  `update match set starts_at = timestamptz '2026-10-07 17:00:00+00'
    where school_id = $1 and away_school_id = $2 and team_code = '1XI'
      and (starts_at at time zone 'Africa/Johannesburg')::date = sa_today() returning id`, [WES, KEA]);
if (moved.length !== 1) throw new Error(`expected one "today" fixture to move, moved ${moved.length}`);
await q(`update trip set depart_at = timestamptz '2026-10-07 16:00:00+00', return_at = timestamptz '2026-10-07 21:00:00+00'
          where match_id = $1`, [moved[0].id]);
console.log("✓ the demo cast, and its first 1XI fixture moved to 7 Oct 19:00 SAST");
writeFileSync(join(dir, "done"), "ok");
await pool.end();

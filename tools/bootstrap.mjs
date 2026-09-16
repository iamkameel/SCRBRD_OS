#!/usr/bin/env node
/**
 * The first person on a fresh database.
 *
 * SCRBRD sends no email: a login code is issued by somebody who already holds
 * user.invite, and handed over by a person who looked at the recipient first
 * (services/api/auth/auth-db.mjs). On a database with nobody in it there is
 * nobody to issue one, so this runs ONCE, as the schema owner, and writes what
 * an invite would have written: the person, a platform-wide platformadmin
 * assignment, and one login code — hashed with the API's SESSION_SECRET, since
 * that is what /api/auth/redeem will hash the typed code with.
 *
 * Optionally the first school as well; the platform account then invites that
 * school's first administrator from the app and never touches psql again.
 *
 *   DATABASE_URL=postgres://scrbrd:...@host/scrbrd SESSION_SECRET=... \
 *     node tools/bootstrap.mjs --email ops@school.co.za --name "Platform Ops" \
 *     [--school HIL "Hilton College" KwaZulu-Natal]
 *
 * Run it again for the same email and it mints a fresh code for the existing
 * person and nothing else — a locked-out operator's recovery path.
 *
 * --owner writes the OWNER'S KEY instead: superadmin, every capability, no
 * school, so it reaches every tenant. Until this flag the only thing that
 * ever created that assignment was 98_seed_pilot.sql — fixture data that must
 * never run on a database holding a real child's record — so the first real
 * pilot would have had no operator key at all. The seed still carries the
 * fixture owner for the demo and for db/99's assertions; this is the one for
 * a real database, minted from outside the platform because nobody inside it
 * may appoint an owner (db/99: platformadmin cannot grant superadmin).
 *
 *   SESSION_SECRET=... node tools/bootstrap.mjs --owner --email you@example.co.za --name "Your Name"
 */
import pg from "pg";
import { newMagicCode } from "../services/api/auth/auth.mjs";

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const email = opt("--email"), name = opt("--name");
const owner = args.includes("--owner");
const ROLE = owner ? "superadmin" : "platformadmin";
const si = args.indexOf("--school");
const school = si >= 0 ? { code: args[si + 1], name: args[si + 2], province: args[si + 3] || null } : null;
const secret = process.env.SESSION_SECRET;
const url = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";

if (!email || !name || !secret || (school && (!school.code || !school.name))) {
  console.error("usage: SESSION_SECRET=... node tools/bootstrap.mjs [--owner] --email E --name N [--school CODE \"Name\" [Province]]");
  process.exit(2);
}

const db = new pg.Client({ connectionString: url });
await db.connect();
try {
  await db.query("begin");
  let schoolId = null;
  if (school) {
    const { rows } = await db.query(
      `insert into school (code, name, kind, province) values ($1, $2, 'school', $3)
       on conflict (code) do update set name = excluded.name returning id`, [school.code, school.name, school.province]);
    schoolId = rows[0].id;
  }
  // The role on app_user is display; the ASSIGNMENT is what app_can() reads.
  // A person bootstrapped twice with different flags keeps both assignments;
  // the display role follows the latest, which is the one they asked for.
  const { rows: people } = await db.query(
    `insert into app_user (email, name, role) values ($1, $2, $3)
     on conflict (email) do update set name = excluded.name, role = excluded.role, active = true returning id`, [email, name, ROLE]);
  const person = people[0].id;
  await db.query(
    `insert into role_assignment (person_id, role, school_id, team_code)
     select $1, $2, null, null
      where not exists (select 1 from role_assignment where person_id = $1 and role = $2 and school_id is null and active)`, [person, ROLE]);
  const { raw, hash, expiresInSec } = newMagicCode(secret);
  await db.query(
    `insert into login_code (user_id, code_hash, expires_at, issued_by) values ($1, $2, now() + make_interval(secs => $3), $1)`,
    [person, hash, expiresInSec]);
  await db.query("commit");
  console.log(`${name} <${email}> ${owner ? "holds the owner's key — every capability, every school" : "is a platform administrator"}${school ? `, and ${school.name} (${school.code}) exists` : ""}.`);
  console.log(`Login code (once, ${Math.round(expiresInSec / 3600)} hours): ${raw}`);
} catch (e) {
  await db.query("rollback").catch(() => {});
  console.error(`✗ ${e.message}`);
  process.exit(1);
} finally {
  await db.end();
}

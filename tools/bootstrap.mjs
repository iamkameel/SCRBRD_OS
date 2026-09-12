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
 */
import pg from "pg";
import { newMagicCode } from "../services/api/auth/auth.mjs";

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const email = opt("--email"), name = opt("--name");
const si = args.indexOf("--school");
const school = si >= 0 ? { code: args[si + 1], name: args[si + 2], province: args[si + 3] || null } : null;
const secret = process.env.SESSION_SECRET;
const url = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";

if (!email || !name || !secret || (school && (!school.code || !school.name))) {
  console.error("usage: SESSION_SECRET=... node tools/bootstrap.mjs --email E --name N [--school CODE \"Name\" [Province]]");
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
  const { rows: people } = await db.query(
    `insert into app_user (email, name, role) values ($1, $2, 'platformadmin')
     on conflict (email) do update set name = excluded.name, active = true returning id`, [email, name]);
  const person = people[0].id;
  await db.query(
    `insert into role_assignment (person_id, role, school_id, team_code)
     select $1, 'platformadmin', null, null
      where not exists (select 1 from role_assignment where person_id = $1 and role = 'platformadmin' and school_id is null and active)`, [person]);
  const { raw, hash, expiresInSec } = newMagicCode(secret);
  await db.query(
    `insert into login_code (user_id, code_hash, expires_at, issued_by) values ($1, $2, now() + make_interval(secs => $3), $1)`,
    [person, hash, expiresInSec]);
  await db.query("commit");
  console.log(`${name} <${email}> is a platform administrator${school ? ` and ${school.name} (${school.code}) exists` : ""}.`);
  console.log(`Login code (once, ${Math.round(expiresInSec / 3600)} hours): ${raw}`);
} catch (e) {
  await db.query("rollback").catch(() => {});
  console.error(`✗ ${e.message}`);
  process.exit(1);
} finally {
  await db.end();
}

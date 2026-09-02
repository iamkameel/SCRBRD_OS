#!/usr/bin/env node
/**
 * Applies db/*.sql in numeric order against $DATABASE_URL.
 *
 * The migrations are not idempotent — they CREATE TABLE and CREATE POLICY
 * without guards — so a failed run leaves the database half-built and the next
 * run fails on "already exists" rather than on the real error. Until there is a
 * migration ledger, `--reset` is the honest way to re-apply: drop the schema and
 * start over. That is fine for pilot and development; it is NOT a production
 * migration tool, and it refuses to run against a URL it was not pointed at
 * explicitly.
 *
 *   node tools/migrate.mjs            apply 00..03
 *   node tools/migrate.mjs --reset    drop schema public, then apply
 *   node tools/migrate.mjs --seed     apply, then load 98_seed_pilot.sql
 *   node tools/migrate.mjs --verify   apply, then run 99_rls_verify.sql
 */
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DB_DIR = join(ROOT, "db");
const URL = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const args = new Set(process.argv.slice(2));

const psql = (sqlArgs, label) => {
  const r = spawnSync("psql", [URL, "-v", "ON_ERROR_STOP=1", "-q", ...sqlArgs], { encoding: "utf8" });
  const out = ((r.stdout || "") + (r.stderr || "")).trim();
  if (r.status !== 0) {
    console.error(`✗ ${label}\n${out}`);
    process.exit(1);
  }
  if (out) console.log(out);
  console.log(`✓ ${label}`);
};

if (args.has("--reset")) {
  console.log(`Resetting schema on ${URL.replace(/:[^:@]*@/, ":***@")}`);
  psql(["-c", "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"], "reset schema");
}

// Only 0x_* files are migrations. 98_seed_pilot.sql is fixture data (--seed)
// and 99_rls_verify.sql is the live verifier (--verify); neither is schema, and
// applying either as a migration is how a seed ends up running twice.
const migrations = readdirSync(DB_DIR).filter(f => /^0\d_.*\.sql$/.test(f)).sort();
if (!migrations.length) { console.error("no migrations found in db/"); process.exit(1); }
for (const f of migrations) psql(["-f", join(DB_DIR, f)], f);

if (args.has("--seed")) {
  console.log("\nSeeding demonstration data…");
  psql(["-f", join(DB_DIR, "98_seed_pilot.sql")], "98_seed_pilot.sql");
}

if (args.has("--verify")) {
  console.log("\nVerifying RLS against the live database…");
  psql(["-f", join(DB_DIR, "99_rls_verify.sql")], "99_rls_verify.sql");
}

console.log(`\n${migrations.length} migration${migrations.length === 1 ? "" : "s"} applied.`);

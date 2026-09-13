#!/usr/bin/env node
/**
 * Applies db/NN_*.sql in numeric order against $DATABASE_URL, and keeps a
 * ledger of what it applied.
 *
 * The ledger is the table schema_migration: one row per file, with the hash
 * of the file as it was applied. On every run each file is one of three
 * things —
 *
 *   not in the ledger              → applied, in ONE transaction (psql -1),
 *                                    and recorded; a failure records nothing
 *                                    and leaves the database as it was
 *   in the ledger, hash unchanged  → skipped
 *   in the ledger, hash changed    → REFUSED. A file that already ran is
 *                                    history, not a draft: the change goes
 *                                    in a new file with a higher number.
 *
 * That last rule is the whole point. Before the ledger, every schema change
 * was an edit to a file that had already been applied, and the only way to
 * apply it was --reset — fine for a pilot database, unthinkable for a school's
 * real one. Now a change after go-live is a new db/1N_*.sql that ALTERs, and
 * the same command applies it to a fresh database and to a live one.
 *
 * During the pilot, editing the 0x files is still the way of working, and
 * --reset (drop the schema, so the ledger goes with it) is still how a
 * development database picks the edits up.
 *
 *   node tools/migrate.mjs            apply what the ledger does not have
 *   node tools/migrate.mjs --reset    drop schema public, then apply everything
 *   node tools/migrate.mjs --seed     apply, then load 98_seed_pilot.sql
 *   node tools/migrate.mjs --verify   apply, then run 99_rls_verify.sql
 *
 * 98_ and 99_ are not migrations and are never recorded: one is fixture data,
 * the other is the live verifier.
 */
import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DB_DIR = join(ROOT, "db");
const URL = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const args = new Set(process.argv.slice(2));

const run = (sqlArgs) => {
  const r = spawnSync("psql", [URL, "-v", "ON_ERROR_STOP=1", "-q", "-X", ...sqlArgs], { encoding: "utf8" });
  return { ok: r.status === 0, out: ((r.stdout || "") + (r.stderr || "")).trim() };
};
const psql = (sqlArgs, label) => {
  const r = run(sqlArgs);
  if (!r.ok) { console.error(`✗ ${label}\n${r.out}`); process.exit(1); }
  if (r.out) console.log(r.out);
  console.log(`✓ ${label}`);
};
const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

if (args.has("--reset")) {
  console.log(`Resetting schema on ${URL.replace(/:[^:@]*@/, ":***@")}`);
  psql(["-c", "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"], "reset schema");
}

// The ledger lives with the schema it describes, so a reset takes it too.
psql(["-c", `CREATE TABLE IF NOT EXISTS schema_migration (
  name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE schema_migration ENABLE ROW LEVEL SECURITY`], "ledger");
// RLS on, no policies: the application role reads nothing of it, which the
// live verifier insists on for every table; the owner, who runs this, reads it regardless.
const ledger = new Map();
{
  const r = run(["-At", "-c", "SELECT name || ' ' || sha256 FROM schema_migration"]);
  if (!r.ok) { console.error(`✗ reading the ledger\n${r.out}`); process.exit(1); }
  for (const line of r.out.split("\n").filter(Boolean)) { const [n, h] = line.split(" "); ledger.set(n, h); }
}

// Only NN_* files are migrations. 98_seed_pilot.sql is fixture data (--seed)
// and 99_rls_verify.sql is the live verifier (--verify); neither is schema, and
// applying either as a migration is how a seed ends up running twice.
const migrations = readdirSync(DB_DIR).filter(f => /^\d\d_.*\.sql$/.test(f) && !/^9[89]_/.test(f)).sort();
if (!migrations.length) { console.error("no migrations found in db/"); process.exit(1); }

let applied = 0, skipped = 0;
for (const f of migrations) {
  const file = join(DB_DIR, f), hash = sha(file), had = ledger.get(f);
  if (had === hash) { skipped++; continue; }
  if (had) {
    console.error(`✗ ${f} was applied to this database and has changed since.\n` +
      `  A file that already ran is history. Put the change in a new db/NN_*.sql with a higher number,\n` +
      `  or, on a development database only, --reset.`);
    process.exit(1);
  }
  // One transaction per file: a failure half-way leaves nothing behind, and
  // the ledger row is written by the same transaction as the schema it records.
  const r = run(["-1", "-f", file, "-c", `INSERT INTO schema_migration (name, sha256) VALUES ('${f}', '${hash}')`]);
  if (!r.ok) { console.error(`✗ ${f}\n${r.out}`); process.exit(1); }
  if (r.out) console.log(r.out);
  console.log(`✓ ${f}`);
  applied++;
}
for (const name of ledger.keys()) if (!migrations.includes(name)) console.log(`! ${name} is in the ledger but not in db/ — it ran once and was removed`);
console.log(`\n${applied} applied, ${skipped} already applied.`);

if (args.has("--seed")) {
  console.log("\nSeeding demonstration data…");
  psql(["-f", join(DB_DIR, "98_seed_pilot.sql")], "98_seed_pilot.sql");
}

if (args.has("--verify")) {
  console.log("\nVerifying RLS against the live database…");
  psql(["-f", join(DB_DIR, "99_rls_verify.sql")], "99_rls_verify.sql");
}

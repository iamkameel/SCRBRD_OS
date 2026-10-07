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
 *   node tools/migrate.mjs --reset-objects
 *                                     the same effect on a MANAGED host, where
 *                                     dropping the schema would take the
 *                                     platform's own objects with it: drops
 *                                     only the objects db/ creates (by name,
 *                                     tools/reset-objects.mjs), leaving
 *                                     extensions, grants and anybody else's
 *                                     objects. Refused off this machine
 *                                     unless I_UNDERSTAND_THIS_ERASES_EVERY_SCRBRD_RECORD=1
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
import { ownerUrl } from "./db-url.mjs";
import { projectObjects, teardownSql } from "./reset-objects.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DB_DIR = join(ROOT, "db");
const URL = ownerUrl();
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
// SCRBRD-025. Best-effort: a shallow clone or a stray working copy with no
// git at all still has to be able to migrate, so a failure here is a null
// note, never a reason to stop.
const gitSha = () => {
  const r = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
};

// --reset drops schema public, and on a managed host that takes the
// platform's own objects with it. DEPLOYING.md has said "never against
// Supabase" since the first deploy; a sentence is not a guard. The URL's host
// decides: anything that is not this machine (or the compose service `db`)
// is refused before psql is ever spawned. The escape hatch names what it does.
const hostOf = (url) => { try { return new globalThis.URL(url).hostname; } catch { return ""; } };
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "db"]);
if (args.has("--reset") && !LOCAL_HOSTS.has(hostOf(URL))
    && process.env.I_UNDERSTAND_THIS_DESTROYS_PRODUCTION !== "1") {
  console.error(`✗ refusing --reset against ${hostOf(URL) || "an unparseable DATABASE_URL"}: not a local database.\n` +
    `  Use --reset-objects on a demonstration database (see DEPLOYING.md), or a new db/NN_*.sql on a real one.\n` +
    `  To override on a database you are certain holds no real record: I_UNDERSTAND_THIS_DESTROYS_PRODUCTION=1`);
  process.exit(2);
}

// --reset-objects is the managed-host path, and a managed host is exactly
// where the real records are. It used to have no guard at all (GA-I02): the
// same host rule now, with its own override, named for what it does — it
// erases every record this project holds on that database, the owner's real
// account and key included.
if (args.has("--reset-objects") && !LOCAL_HOSTS.has(hostOf(URL))
    && process.env.I_UNDERSTAND_THIS_ERASES_EVERY_SCRBRD_RECORD !== "1") {
  console.error(`✗ refusing --reset-objects against ${hostOf(URL) || "an unparseable DATABASE_URL"}: not a local database.\n` +
    `  It erases every record this project holds there. On a real database a schema change is a new db/NN_*.sql\n` +
    `  (node tools/bundle-sql.mjs --apply NN). On a demonstration database you are certain holds no real record:\n` +
    `  I_UNDERSTAND_THIS_ERASES_EVERY_SCRBRD_RECORD=1`);
  process.exit(2);
}

if (args.has("--reset")) {
  console.log(`Resetting schema on ${URL.replace(/:[^:@]*@/, ":***@")}`);
  psql(["-c", "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"], "reset schema");
}

// ── --reset-objects: what --reset cannot be on a managed host ────
//
// `DROP SCHEMA public CASCADE` is the right hammer on a database that is
// only ours. On Supabase it is not: the platform keeps its own grants and
// default privileges on `public`, and extensions are commonly installed INTO
// it, so dropping and recreating the schema takes objects the platform
// expects to still be there and leaves a project that looks fine until
// something reaches for pgcrypto.
//
// So this drops what WE created and nothing else: the tables, views,
// routines, types and sequences this repository's migrations create, BY
// NAME (tools/reset-objects.mjs reads them out of db/), and never anything
// belonging to an extension. It used to take every such object in public,
// ours or not (GA-I02); now an object db/ does not name survives, and one of
// somebody else's that depends on one of ours stops the reset before it
// starts. The ledger goes with it — it is one of our tables — so the next
// run applies every migration from the beginning, which is the point.
if (args.has("--reset-objects")) {
  console.log(`Dropping this project's objects in public on ${URL.replace(/:[^:@]*@/, ":***@")}`);
  psql(["-c", teardownSql(projectObjects(DB_DIR))], "drop this project's objects");
}

// The ledger lives with the schema it describes, so a reset takes it too.
// `note` is added separately with IF NOT EXISTS: CREATE TABLE IF NOT EXISTS
// is a no-op against a ledger this project already provisioned, and that
// database still needs the column to record which commit applied a migration
// from here on.
psql(["-c", `CREATE TABLE IF NOT EXISTS schema_migration (
  name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE schema_migration ADD COLUMN IF NOT EXISTS note text;
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

const commitSha = gitSha();
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
  const note = commitSha ? `'${commitSha}'` : "NULL";
  const r = run(["-1", "-f", file, "-c", `INSERT INTO schema_migration (name, sha256, note) VALUES ('${f}', '${hash}', ${note})`]);
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

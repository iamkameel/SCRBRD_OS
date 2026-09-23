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
 *                                     only what this project created in
 *                                     public, leaving extensions and grants
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
// So this drops what WE created and nothing else: every view, table, routine
// and type owned by this role in `public`, leaving the schema itself, its
// grants, and anything belonging to an extension exactly as they were. The
// ledger goes with it — it is one of our tables — so the next run applies
// every migration from the beginning, which is the point.
//
// It is derived from the catalogue rather than from a list written here,
// because a hand-kept list of "our objects" is wrong the first time somebody
// adds a table and does not update it, which is the staleness this codebase
// keeps closing everywhere else.
if (args.has("--reset-objects")) {
  console.log(`Dropping this project's objects in public on ${URL.replace(/:[^:@]*@/, ":***@")}`);
  // pg_depend with deptype 'e' is "this object belongs to an extension".
  // Excluding it is what keeps pgcrypto, pgjwt and friends alive.
  const NOT_EXTENSION = `NOT EXISTS (SELECT 1 FROM pg_depend d
      WHERE d.objid = c.oid AND d.deptype = 'e')`;
  const drop = `
DO $reset_objects$
DECLARE r record; rt text; sigs text[]; n int := 0;
BEGIN
  -- Views first: a view over a table we are about to drop would go with it
  -- under CASCADE anyway, but dropping them explicitly keeps the count honest.
  FOR r IN SELECT c.relname FROM pg_class c
            JOIN pg_namespace ns ON ns.oid = c.relnamespace
           WHERE ns.nspname = 'public' AND c.relkind IN ('v','m') AND ${NOT_EXTENSION}
  LOOP EXECUTE format('DROP VIEW IF EXISTS public.%I CASCADE', r.relname); n := n + 1; END LOOP;

  FOR r IN SELECT c.relname FROM pg_class c
            JOIN pg_namespace ns ON ns.oid = c.relnamespace
           WHERE ns.nspname = 'public' AND c.relkind = 'r' AND ${NOT_EXTENSION}
  LOOP EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', r.relname); n := n + 1; END LOOP;

  -- Routines, by identity rather than by name: this schema overloads
  -- (app_can has defaults, official_level takes one argument or two), and
  -- dropping by name alone is ambiguous and fails.
  --
  -- The signatures are collected as TEXT up front, before anything is
  -- dropped. Read lazily from a cursor instead, a routine already taken by
  -- an earlier CASCADE no longer resolves, and oid::regprocedure renders
  -- it as a bare number — which then reaches DROP FUNCTION as a syntax
  -- error and takes the whole teardown down with it. to_regprocedure() on
  -- the way back in is the matching half: it returns NULL for a signature
  -- that has since gone, rather than raising.
  --
  -- The extension exclusion above is what lets this FINISH, and the failure
  -- it prevents is worth naming exactly, because it is not the one you
  -- would guess. Postgres refuses to drop an extension member on its own
  -- ("cannot drop function pgp_pub_decrypt_bytea(...) because extension
  -- pgcrypto requires it"), so without the exclusion pgcrypto is not
  -- destroyed — the teardown ABORTS on it, after the table loop above has
  -- already run, leaving the database half torn down. Checked by removing
  -- the exclusion and watching it happen.
  SELECT coalesce(array_agg(p.oid::regprocedure::text), '{}')
      INTO sigs
      FROM pg_proc p
      JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e');
    FOREACH rt IN ARRAY sigs LOOP
      IF to_regprocedure(rt) IS NOT NULL THEN
        EXECUTE format('DROP FUNCTION IF EXISTS %s CASCADE', rt);
        n := n + 1;
      END IF;
    END LOOP;

  FOR r IN SELECT t.typname FROM pg_type t
            JOIN pg_namespace ns ON ns.oid = t.typnamespace
           WHERE ns.nspname = 'public' AND t.typtype = 'e'
             AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = t.oid AND d.deptype = 'e')
  LOOP EXECUTE format('DROP TYPE IF EXISTS public.%I CASCADE', r.typname); n := n + 1; END LOOP;

  RAISE NOTICE 'dropped % object(s) in public', n;
END
$reset_objects$;`;
  psql(["-c", drop], "drop this project's objects");
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

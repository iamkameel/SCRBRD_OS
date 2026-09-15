#!/usr/bin/env node
/**
 * One .sql file you can paste into a hosted SQL editor.
 *
 * tools/migrate.mjs is the way to apply this schema, and it needs a terminal,
 * a clone on the right branch, psql on the PATH and a connection string. That
 * is four things to get wrong before anything happens, and getting the branch
 * wrong is the quiet one: the migrator reads db/*.sql from the working copy,
 * so a clone sitting on an older commit applies the OLD schema and reports
 * success. The deploy then serves code against a database that does not match
 * it, which is a 500 on a screen that worked yesterday.
 *
 * This assembles the same work into a single paste: the teardown, every
 * migration in order, the ledger rows, and the seed. Supabase's SQL Editor
 * runs it as-is.
 *
 * THE LEDGER ROWS ARE THE POINT of doing this properly rather than pasting
 * the files by hand. Without them the next `node tools/migrate.mjs` sees an
 * empty schema_migration, tries to apply everything again, and fails on the
 * first CREATE. With them, the two paths agree — checked by running this
 * bundle into an empty database and then asking the migrator, which answers
 * "0 applied, 10 already applied".
 *
 * The teardown and the NOT_EXTENSION predicate are lifted out of migrate.mjs
 * rather than retyped: a second copy of a destructive statement is a second
 * thing to get wrong, and this one drops every table in the database.
 *
 *   node tools/bundle-sql.mjs
 *     → scrbrd-supabase-rebuild.sql   (paste, Run)
 *     → scrbrd-supabase-verify.sql    (paste, Run — expect ALL RLS LIVE ASSERTIONS PASSED)
 *
 * Both outputs are generated and git-ignored. This file is the source.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const DB = "/home/user/SCRBRD_OS/db";
const sha = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");
const src = readFileSync("/home/user/SCRBRD_OS/tools/migrate.mjs", "utf8");

// Lift the teardown verbatim from the migrator rather than retyping it: a
// second copy of a destructive statement is a second thing to get wrong.
const m = src.match(/const drop = `([\s\S]*?)`;\n/);
if (!m) throw new Error("could not find the teardown block in migrate.mjs");
// The block is a JS template literal, so resolve its one interpolation from
// the same file rather than pasting a second copy of the predicate.
const nx = src.match(/const NOT_EXTENSION = `([\s\S]*?)`;/);
if (!nx) throw new Error("could not find NOT_EXTENSION in migrate.mjs");
const teardown = m[1]
  .replace(/\$\{NOT_EXTENSION\}/g, nx[1])
  .replace(/\\`/g, "`");
if (/\$\{/.test(teardown)) throw new Error("unresolved interpolation left in the teardown");

const migrations = readdirSync(DB).filter(f => /^\d\d_.*\.sql$/.test(f) && !/^9[89]_/.test(f)).sort();

const parts = [`-- ═══════════════════════════════════════════════════════════════
--  SCRBRD — full schema rebuild for Supabase's SQL Editor
--
--  Generated from db/ by hand-free assembly. It does exactly what
--    node tools/migrate.mjs --reset-objects --seed
--  does, in one paste, so no terminal, psql or clone is needed.
--
--  IT DESTROYS EVERYTHING THIS PROJECT CREATED in the public schema and
--  reseeds with invented demonstration people. Supabase's own objects and
--  anything belonging to an extension are left alone.
--
--  Files, in order: ${migrations.join(", ")}, 98_seed_pilot.sql
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Drop this project's objects ──────────────────────────────
${teardown}

-- ── 2. The ledger, so the command-line migrator still works later ──
DROP TABLE IF EXISTS schema_migration;
CREATE TABLE schema_migration (
  name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE schema_migration ENABLE ROW LEVEL SECURITY;
`];

let step = 3;
for (const f of migrations) {
  parts.push(`
-- ══════════════════════════════════════════════════════════════════
-- ── ${step}. ${f} ──
-- ══════════════════════════════════════════════════════════════════
${readFileSync(join(DB, f), "utf8")}
INSERT INTO schema_migration (name, sha256) VALUES ('${f}', '${sha(join(DB, f))}');
`);
  step++;
}

parts.push(`
-- ══════════════════════════════════════════════════════════════════
-- ── ${step}. 98_seed_pilot.sql — the demonstration data ──
-- ══════════════════════════════════════════════════════════════════
${readFileSync(join(DB, "98_seed_pilot.sql"), "utf8")}
`);

writeFileSync("/home/user/SCRBRD_OS/scrbrd-supabase-rebuild.sql", parts.join("\n"));

// The verifier, with psql-only meta-commands stripped so it runs in the editor.
const verify = readFileSync(join(DB, "99_rls_verify.sql"), "utf8")
  .split("\n").filter(l => !/^\\/.test(l)).join("\n");
writeFileSync("/home/user/SCRBRD_OS/scrbrd-supabase-verify.sql", verify);
console.log("wrote scrbrd-supabase-rebuild.sql and scrbrd-supabase-verify.sql");

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
//
// AND A VISIBLE ANSWER ON THE END, which is the part that was missing. The
// file signals success with RAISE NOTICE, and a hosted SQL editor shows result
// ROWS and not notices — so a fully green run renders as "Success. No rows
// returned", which is indistinguishable from a file that did nothing at all.
// The reasoning still holds (a failed assertion raises, and an exception would
// paint an error), but "no news is good news" is a poor thing to ask somebody
// to trust while they are staring at an empty result pane.
//
// It runs AFTER the ROLLBACK on purpose: the transaction above undoes the
// test's own mutations, and this then reads the state that actually persisted.
const verify = readFileSync(join(DB, "99_rls_verify.sql"), "utf8")
  .split("\n").filter(l => !/^\\/.test(l)).join("\n")
  + `
-- ── Did it work? The answer, as rows you can see ────────────────
-- Every column below should read OK. Anything else is a real problem:
-- send this table back rather than trying to interpret it.
SELECT
  CASE WHEN (SELECT count(*) FROM role_capability WHERE role = 'superadmin')
          = (SELECT count(*) FROM capability)
       THEN 'OK — ' || (SELECT count(*) FROM capability) || ' capabilities'
       ELSE 'PROBLEM' END                                       AS "Super Admin holds every key",
  -- A LIVE owner's key: a platform-wide superadmin assignment on an active
  -- account. On the demonstration database that is the seeded fixture owner;
  -- on a real one it is whoever ran tools/bootstrap.mjs --owner.
  CASE WHEN EXISTS (SELECT 1 FROM role_assignment a JOIN app_user u ON u.id = a.person_id
                     WHERE a.role = 'superadmin' AND a.school_id IS NULL AND a.active AND u.active
                       AND (a.valid_until IS NULL OR a.valid_until > current_date))
       THEN 'OK' ELSE 'PROBLEM — nobody holds it' END              AS "An owner's key exists",
  CASE WHEN to_regprocedure('enrol_person(text,text,text,uuid,text,uuid,text)') IS NOT NULL
       THEN 'OK' ELSE 'PROBLEM' END                             AS "Enrolment exists",
  CASE WHEN to_regprocedure('majority_on(date)') IS NOT NULL
       THEN 'OK' ELSE 'PROBLEM' END                             AS "Guardianship ends at 18",
  CASE WHEN (SELECT count(*) FROM assignment_subject s
               JOIN role_assignment a ON a.id = s.assignment_id AND a.role = 'guardian'
              WHERE s.valid_until IS NULL) = 0
       THEN 'OK — none open-ended' ELSE 'PROBLEM' END            AS "Every guardian link has an end date",
  CASE WHEN (SELECT count(*) FROM schema_migration) = ${migrations.length}
       THEN 'OK — ${migrations.length} applied'
       ELSE 'PROBLEM — ' || (SELECT count(*) FROM schema_migration)::text END AS "Migration ledger",
  CASE WHEN (SELECT count(*) FROM player) > 0
       THEN 'OK — ' || (SELECT count(*) FROM player) || ' players seeded'
       ELSE 'PROBLEM' END                                        AS "Demo data",
  -- The two things a rebuild is FOR, once the schema is already live: the
  -- floor under the date-of-birth rule, and the seeded ID numbers that stopped
  -- agreeing with their birthdays when those became relative.
  CASE WHEN EXISTS (SELECT 1 FROM pg_constraint
                     WHERE conname = 'player_born_required' AND convalidated)
       THEN 'OK — enforced' ELSE 'PROBLEM' END                    AS "Date of birth required",
  CASE WHEN (SELECT count(*) FROM player
              WHERE id_number IS NOT NULL
                AND to_char(born, 'YYMMDD') <> substring(id_number FROM 1 FOR 6)) = 0
       THEN 'OK — all agree' ELSE 'PROBLEM' END                   AS "ID numbers match birthdays";
`;
writeFileSync("/home/user/SCRBRD_OS/scrbrd-supabase-verify.sql", verify);
console.log("wrote scrbrd-supabase-rebuild.sql and scrbrd-supabase-verify.sql");

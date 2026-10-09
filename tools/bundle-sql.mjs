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
 * The teardown is tools/reset-objects.mjs's, the same one migrate.mjs runs,
 * rather than retyped: a second copy of a destructive statement is a second
 * thing to get wrong, and this one drops every table this project made.
 *
 *   node tools/bundle-sql.mjs
 *     → scrbrd-supabase-rebuild.sql   (paste, Run)
 *     → scrbrd-supabase-verify.sql    (paste, Run — expect ALL RLS LIVE ASSERTIONS PASSED)
 *
 * Both outputs are generated and git-ignored. This file is the source.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { projectObjects, teardownSql } from "./reset-objects.mjs";

// Relative to this file, not a hard-coded checkout: run from a worktree or a
// clone elsewhere, a fixed path silently bundled a DIFFERENT tree's db/.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DB = join(ROOT, "db");
const sha = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");
// SCRBRD-025. A bundle pasted into Supabase's SQL Editor otherwise leaves no
// record of which commit produced it — the ledger says WHEN and WHAT
// (sha256 per file), never which git state chose that file set. Best-effort:
// a shallow clone with no git history still has to be able to write a bundle.
const gitShaResult = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
const COMMIT = gitShaResult.status === 0 ? gitShaResult.stdout.trim() : null;
const noteSql = COMMIT ? `'${COMMIT}'` : "NULL";

// The teardown is the migrator's own, from the one module both use: a second
// copy of a destructive statement is a second thing to get wrong. It drops,
// by name, only what db/ creates (GA-I02), and refuses before dropping
// anything if somebody else's object depends on one of ours.
const teardown = teardownSql(projectObjects(DB));

const migrations = readdirSync(DB).filter(f => /^\d\d_.*\.sql$/.test(f) && !/^9[89]_/.test(f)).sort();

// ── --apply NN: one migration, for a database that already has the rest ──
//
// The rebuild bundle tears the demonstration database down and reseeds it,
// which also throws away anything a person added since — the owner's real
// account and key, minted after the last rebuild. A ledgered database wants
// what tools/migrate.mjs would do: apply the one file it does not have and
// record it. This is that, as a paste: refuses if the file is already in the
// ledger or its predecessor is not, then the file verbatim, then the ledger
// row with the same hash the migrator would write.
const applyAt = process.argv.indexOf("--apply");
if (applyAt >= 0) {
  const nn = String(process.argv[applyAt + 1] ?? "").padStart(2, "0");
  const file = migrations.find((f) => f.startsWith(nn + "_"));
  if (!file) { console.error(`no migration ${nn}_*.sql in db/`); process.exit(2); }
  const prev = migrations[migrations.indexOf(file) - 1] ?? null;
  const out = `-- ══════════════════════════════════════════════════════════════════
--  SCRBRD — apply ${file} to a database that already has the rest
-- ══════════════════════════════════════════════════════════════════
--
--  For the Supabase SQL Editor. Nothing here tears anything down: it is the
--  one migration and its ledger row, exactly what \`node tools/migrate.mjs\`
--  would apply to this database. Refuses to run twice, and refuses to run
--  ahead of its predecessor.
DO $apply$
BEGIN
  IF EXISTS (SELECT 1 FROM schema_migration WHERE name = '${file}') THEN
    RAISE EXCEPTION '${file} is already in this database''s ledger — nothing to do';
  END IF;${prev ? `
  IF NOT EXISTS (SELECT 1 FROM schema_migration WHERE name = '${prev}') THEN
    RAISE EXCEPTION '${prev} has not been applied here — apply it first, or use the rebuild bundle';
  END IF;` : ""}
END $apply$;

-- A database ledgered by a bundle from before SCRBRD-025 has no note column
-- yet; this reaches it either way.
ALTER TABLE schema_migration ADD COLUMN IF NOT EXISTS note text;

-- ── ${file} ──
${readFileSync(join(DB, file), "utf8")}

-- ── the ledger row, with the hash the migrator would record and the commit
--    this bundle was generated from ──
INSERT INTO schema_migration (name, sha256, note) VALUES ('${file}', '${sha(join(DB, file))}', ${noteSql});
`;
  const target = join(ROOT, `scrbrd-supabase-apply-${nn}.sql`);
  writeFileSync(target, out);
  console.log(`wrote scrbrd-supabase-apply-${nn}.sql (${file}, after ${prev ?? "nothing"})`);
  process.exit(0);
}

const parts = [`-- ═══════════════════════════════════════════════════════════════
--  SCRBRD — full schema rebuild for Supabase's SQL Editor
--
--  Generated from db/ by hand-free assembly. It does exactly what
--    node tools/migrate.mjs --reset-objects --seed
--  does, in one paste, so no terminal, psql or clone is needed.
--
--  IT DESTROYS EVERYTHING THIS PROJECT CREATED in the public schema and
--  reseeds with invented demonstration people. Only objects db/ creates are
--  dropped, by name: Supabase's own, anything belonging to an extension, and
--  any other application's are left alone — and if one of those depends on
--  one of ours, section 1 refuses before it drops anything.
--
--  NEVER on a database holding a real record: there, a schema change is
--  node tools/bundle-sql.mjs --apply NN (DEPLOYING.md).
--
--  Files, in order: ${migrations.join(", ")}, 98_seed_pilot.sql
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Drop this project's objects ──────────────────────────────
${teardown}

-- ── 2. The ledger, so the command-line migrator still works later ──
DROP TABLE IF EXISTS schema_migration;
CREATE TABLE schema_migration (
  name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now(),
  note text);
ALTER TABLE schema_migration ENABLE ROW LEVEL SECURITY;
`];

let step = 3;
for (const f of migrations) {
  parts.push(`
-- ══════════════════════════════════════════════════════════════════
-- ── ${step}. ${f} ──
-- ══════════════════════════════════════════════════════════════════
${readFileSync(join(DB, f), "utf8")}
INSERT INTO schema_migration (name, sha256, note) VALUES ('${f}', '${sha(join(DB, f))}', ${noteSql});
`);
  step++;
}

parts.push(`
-- ══════════════════════════════════════════════════════════════════
-- ── ${step}. 98_seed_pilot.sql — the demonstration data ──
-- ══════════════════════════════════════════════════════════════════
${readFileSync(join(DB, "98_seed_pilot.sql"), "utf8")}
`);

writeFileSync(join(ROOT, "scrbrd-supabase-rebuild.sql"), parts.join("\n"));

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
  -- Every key but safeguarding.*, which only the DSO holds (db/57).
  CASE WHEN (SELECT count(*) FROM role_capability WHERE role = 'superadmin')
          = (SELECT count(*) FROM capability WHERE name NOT LIKE 'safeguarding.%')
        AND NOT EXISTS (SELECT 1 FROM role_capability
                         WHERE role = 'superadmin' AND capability LIKE 'safeguarding.%')
       THEN 'OK — ' || (SELECT count(*) FROM capability WHERE name NOT LIKE 'safeguarding.%')
            || ' capabilities; safeguarding is the DSO''s'
       ELSE 'PROBLEM' END                                       AS "Super Admin holds every key",
  -- A LIVE owner's key: a platform-wide superadmin assignment on an active
  -- account. On the demonstration database that is the seeded fixture owner;
  -- on a real one it is whoever ran tools/bootstrap.mjs --owner.
  CASE WHEN EXISTS (SELECT 1 FROM role_assignment a JOIN app_user u ON u.id = a.person_id
                     WHERE a.role = 'superadmin' AND a.school_id IS NULL AND a.active AND u.active
                       AND (a.valid_until IS NULL OR a.valid_until > current_date))
       THEN 'OK' ELSE 'PROBLEM — nobody holds it' END              AS "An owner's key exists",
  CASE WHEN to_regprocedure('owner_recovery_issue(text,text,integer)') IS NOT NULL
       THEN 'OK' ELSE 'PROBLEM' END                              AS "Owner has a way back in",
  CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
              WHERE ns.nspname = 'public' AND p.prosecdef AND p.proname NOT LIKE '\\_%'
                AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig,'{}')) c WHERE c LIKE 'search_path=%')) = 0
       THEN 'OK — all pinned' ELSE 'PROBLEM' END                  AS "Definer functions pin search_path",
  CASE WHEN to_regclass('request_replay') IS NOT NULL
       THEN 'OK' ELSE 'PROBLEM' END                             AS "Retries write once",
  CASE WHEN to_regprocedure('quarantine_resolve(bigint,boolean,jsonb,text)') IS NOT NULL
       THEN 'OK' ELSE 'PROBLEM' END                             AS "Quarantine has a way out",
  CASE WHEN to_regprocedure('enrol_person(text,text,text,uuid,text,uuid,text)') IS NOT NULL
       THEN 'OK' ELSE 'PROBLEM' END                             AS "Enrolment exists",
  -- A guardian link ends at the later of the child's eighteenth birthday and
  -- the day he leaves the school system (db/62, SCRBRD-110 §7.4). So: no
  -- guardian link still reaches an adult who is not at school — an adult out
  -- of school has an ended link — and a link is open-ended only while the
  -- child is a minor or still_at_school(). Both were "ends at 18" and "has an
  -- end date" before db/62; the second's old name is no longer true.
  CASE WHEN to_regprocedure('majority_on(date)') IS NOT NULL
        AND to_regprocedure('still_at_school(uuid)') IS NOT NULL
        AND (SELECT count(*) FROM assignment_subject s
               JOIN role_assignment a ON a.id = s.assignment_id AND a.role = 'guardian'
               JOIN player p ON p.id = s.player_id
              WHERE (s.valid_until IS NULL OR s.valid_until > current_date)
                AND NOT coalesce(majority_on(p.born) > current_date, false)
                AND NOT still_at_school(p.id)) = 0
       THEN 'OK' ELSE 'PROBLEM' END                             AS "Guardianship ends at 18, or on leaving school",
  CASE WHEN to_regprocedure('still_at_school(uuid)') IS NOT NULL
        AND (SELECT count(*) FROM assignment_subject s
               JOIN role_assignment a ON a.id = s.assignment_id AND a.role = 'guardian'
               JOIN player p ON p.id = s.player_id
              WHERE s.valid_until IS NULL
                AND NOT coalesce(majority_on(p.born) > current_date, false)
                AND NOT still_at_school(p.id)) = 0
       THEN 'OK — ' || (SELECT count(*) FROM assignment_subject s
                          JOIN role_assignment a ON a.id = s.assignment_id AND a.role = 'guardian'
                         WHERE s.valid_until IS NULL) || ' open, each a minor''s or a pupil''s'
       ELSE 'PROBLEM' END                                       AS "Open guardian links are minors' or pupils'",
  CASE WHEN to_regprocedure('dob_gaps()') IS NOT NULL
       THEN 'OK' ELSE 'PROBLEM' END                             AS "Data-quality gaps are visible",
  CASE WHEN to_regprocedure('app_is_platform_wide()') IS NOT NULL
        AND EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name = 'access_log' AND column_name = 'platform_wide')
       THEN 'OK' ELSE 'PROBLEM' END                             AS "Platform-wide reads are on the record",
  CASE WHEN to_regprocedure('support_access_begin(uuid,text,text,text,integer)') IS NOT NULL
        AND pg_get_functiondef('app_can(text,uuid,text,uuid,uuid)'::regprocedure) LIKE '%expires_at%'
       THEN 'OK — an hour, on the record' ELSE 'PROBLEM' END     AS "Support access is time-boxed",
  -- db/85 (GA-I03): the request's identity is set only after its session is
  -- checked, and disabling an account or removing a sign-in ends sessions.
  CASE WHEN to_regprocedure('app_session_begin(uuid,text,uuid,integer,uuid)') IS NOT NULL
        AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'auth_account_disabled' AND tgenabled = 'O')
        AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'auth_sign_in_removed' AND tgenabled = 'O')
       THEN 'OK' ELSE 'PROBLEM' END                             AS "Sessions end when ended",
  -- db/86: superadmin and platformadmin are never appointed at a school.
  CASE WHEN EXISTS (SELECT 1 FROM pg_constraint
                     WHERE conname = 'platform_role_needs_no_school' AND convalidated)
        AND NOT EXISTS (SELECT 1 FROM role_assignment
                         WHERE role IN ('superadmin', 'platformadmin') AND school_id IS NOT NULL)
       THEN 'OK' ELSE 'PROBLEM' END                             AS "Platform roles belong to no school",
  -- db/87: a wide or a no-ball carries only the ways out the Laws allow off
  -- it (Law 22.9, 21.17), and every reader counts that wicket.
  CASE WHEN to_regprocedure('ball_is_wicket(text,text)') IS NOT NULL
        AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'ball_event_out_off_extra' AND tgenabled = 'O')
        AND pg_get_functiondef('ball_wicket_stands(uuid,smallint,integer,text,text,text)'::regprocedure) LIKE '%ball_is_wicket(%'
       THEN 'OK' ELSE 'PROBLEM' END                             AS "Wickets off a wide or no-ball",
  -- db/89: notices are one of nine kinds, none public, the contract a trigger,
  -- retraction one door the application cannot open (NOTIFICATIONS.md S1).
  CASE WHEN EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notification_kind_known' AND convalidated)
        AND NOT EXISTS (SELECT 1 FROM notification WHERE is_public)
        AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'notification_contract' AND tgenabled = 'O')
        AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'notification_retraction_door' AND tgenabled = 'O')
        AND to_regclass('my_notifications') IS NOT NULL
        AND NOT has_function_privilege('scrbrd_app', 'notification_retract(uuid,text,boolean)', 'EXECUTE')
       THEN 'OK' ELSE 'PROBLEM' END                             AS "Notices keep their contract",
  -- db/90: an account is disabled or enabled through one door, with a reason
  -- on the record; the application cannot write app_user.active itself.
  CASE WHEN to_regclass('account_status_change') IS NOT NULL
        AND to_regprocedure('account_set_active(uuid,boolean,text)') IS NOT NULL
        AND to_regprocedure('account_set_active(uuid,boolean)') IS NULL
        AND NOT has_column_privilege('scrbrd_app', 'app_user', 'active', 'UPDATE')
       THEN 'OK' ELSE 'PROBLEM' END                             AS "Accounts change with a reason",
  -- db/91: a person's words become a notice only through a post, whose
  -- trigger writes it; any reader may report one (NOTIFICATIONS.md S2).
  CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'news_post_notice' AND tgenabled = 'O')
        AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'news_post' AND column_name = 'urgency')
        AND EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'notification' AND policyname = 'notification_notice_insert_system')
        AND EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'notification' AND policyname = 'notification_notice_update_system')
        AND has_function_privilege('scrbrd_app', 'notification_report(uuid)', 'EXECUTE')
        AND has_function_privilege('scrbrd_app', 'news_post_withdraw(uuid)', 'EXECUTE')
        AND NOT has_function_privilege('scrbrd_app', 'news_post_notice()', 'EXECUTE')
       THEN 'OK' ELSE 'PROBLEM' END                             AS "Posts write their notices",
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
  CASE WHEN EXISTS (SELECT 1 FROM pg_constraint
                     WHERE conname = 'ball_event_dismissal_known' AND convalidated)
       THEN 'OK — eleven ways out' ELSE 'PROBLEM' END              AS "Dismissals are a closed list",
  CASE WHEN (SELECT count(*) FROM player
              WHERE id_number IS NOT NULL
                AND to_char(born, 'YYMMDD') <> substring(id_number FROM 1 FOR 6)) = 0
       THEN 'OK — all agree' ELSE 'PROBLEM' END                   AS "ID numbers match birthdays";
`;
writeFileSync(join(ROOT, "scrbrd-supabase-verify.sql"), verify);
console.log("wrote scrbrd-supabase-rebuild.sql and scrbrd-supabase-verify.sql");

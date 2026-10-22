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
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { projectObjects, teardownSql } from "./reset-objects.mjs";
import { migrationFiles } from "../services/api/migration-names.mjs";

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

const migrations = migrationFiles(DB);

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
  -- These rows look their objects up with to_regprocedure()/to_regclass(), so a
  -- database without the migration reads PROBLEM here instead of failing the
  -- whole check (a ::regprocedure cast is resolved before anything runs).
  -- db/92: the staff register is read and written through its functions
  -- alone, and grants through the one door decide_role_request() uses.
  CASE WHEN to_regclass('school_register') IS NOT NULL
        AND (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('school_register'))
        AND NOT has_table_privilege('scrbrd_app', to_regclass('school_register'), 'SELECT')
        AND has_function_privilege('scrbrd_app', to_regprocedure('register_claim(uuid)'), 'EXECUTE')
        AND NOT has_function_privilege('scrbrd_app', to_regprocedure('role_request_grant_as(uuid,uuid,text,uuid,text)'), 'EXECUTE')
        AND position('role_request_grant_as(' IN (SELECT prosrc FROM pg_proc
                      WHERE oid = to_regprocedure('decide_role_request(uuid,boolean,text,uuid,text)'))) > 0
       THEN 'OK' ELSE 'PROBLEM' END                             AS "Staff register is the office's",
  -- db/93: a declined parent claim tells the DSO; repeated ones pause the asker.
  CASE WHEN to_regclass('request_cooldown') IS NOT NULL
        AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'role_request_declined_notice' AND tgenabled = 'O')
        AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'role_request_cooldown' AND tgenabled = 'O')
        AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'pending_claim_declined_notice' AND tgenabled = 'O')
        AND has_function_privilege('scrbrd_app', to_regprocedure('request_cooldown_lift(uuid,text)'), 'EXECUTE')
       THEN 'OK' ELSE 'PROBLEM' END                             AS "Declined parent claims reach the DSO",
  -- db/94: a boy's overs today across every match, to whoever may read his
  -- load and nobody else (SCRBRD-136/137 phase B §1).
  CASE WHEN to_regprocedure('bowler_day(date,text)') IS NOT NULL
        AND (SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure('bowler_day(date,text)'))
        AND coalesce(pg_get_functiondef(to_regprocedure('bowler_day(date,text)')), '') LIKE '%app_can(''player.workload.read''%'
        AND has_function_privilege('scrbrd_app', to_regprocedure('bowler_day(date,text)'), 'EXECUTE')
        AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                         WHERE p.oid IN (to_regprocedure('bowler_day(date,text)'), to_regprocedure('bowling_directive_for(uuid)'))
                           AND x.grantee = 0 AND x.privilege_type = 'EXECUTE')
       THEN 'OK' ELSE 'PROBLEM' END                             AS "A bowler's day is read under the load capability",
  -- db/96: the coach's plan is a team post tagged to a fixture, one live per
  -- side, never public (SCRBRD-138 phase B §1).
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'news_post' AND column_name = 'kind')
        AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'news_post' AND column_name = 'fixture_id')
        AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'news_post_plan_guard' AND tgenabled = 'O')
        AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'news_post_public_not_plan' AND tgenabled = 'O')
        AND EXISTS (SELECT 1 FROM pg_index i WHERE i.indexrelid = to_regclass('news_post_plan_live') AND i.indisunique)
        AND NOT has_function_privilege('scrbrd_app', to_regprocedure('news_post_plan_guard()'), 'EXECUTE')
        AND (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND permissive = 'RESTRICTIVE'
              AND (tablename, policyname) IN (('news_post', 'news_post_plan_side'), ('notification', 'notification_plan_side'))) = 2
       THEN 'OK' ELSE 'PROBLEM' END                             AS "A plan is one per side, to the side",
  -- db/97: the ball log follows the fixture; the away side reads its match
  -- (SCRBRD-136/137 away visibility, AV-D1). The writes stay the host's.
  CASE WHEN EXISTS (SELECT 1 FROM pg_policy p
                     WHERE p.polrelid = 'ball_event'::regclass AND p.polname = 'ball_event_read'
                       AND p.polcmd = 'r' AND p.polpermissive
                       AND pg_get_expr(p.polqual, p.polrelid) LIKE '%match_team(%'
                       AND pg_get_expr(p.polqual, p.polrelid) LIKE '%away_school_id%'
                       AND pg_get_expr(p.polqual, p.polrelid) LIKE '%away_team_code%')
        AND NOT EXISTS (SELECT 1 FROM pg_policy p
                         WHERE p.polrelid = 'ball_event'::regclass AND p.polname = 'ball_event_insert'
                           AND pg_get_expr(p.polwithcheck, p.polrelid) LIKE '%away\\_%')
       THEN 'OK' ELSE 'PROBLEM' END                             AS "The away side reads its fixture's balls",
  -- db/100: a parent reads the ball log of his child's side's fixtures, asked
  -- about the child (never the all-zeros person); the writes stay the host's.
  CASE WHEN to_regclass('ball_event') IS NOT NULL
        AND to_regprocedure('my_child_fixtures()') IS NOT NULL
        AND EXISTS (SELECT 1 FROM pg_policy p
                     WHERE p.polrelid = to_regclass('ball_event') AND p.polname = 'ball_event_read'
                       AND p.polcmd = 'r' AND p.polpermissive
                       AND pg_get_expr(p.polqual, p.polrelid) LIKE '%my_child_fixtures()%'
                       AND pg_get_expr(p.polqual, p.polrelid) NOT LIKE '%00000000-0000-0000-0000-000000000000%')
        AND (SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure('my_child_fixtures()'))
        AND (SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('my_child_fixtures()')) LIKE '%p.id, m.id)%'
        AND has_function_privilege('scrbrd_app', to_regprocedure('my_child_fixtures()'), 'EXECUTE')
        AND NOT has_function_privilege('public', to_regprocedure('my_child_fixtures()'), 'EXECUTE')
        AND NOT EXISTS (SELECT 1 FROM pg_policy p
                         WHERE p.polrelid = to_regclass('ball_event') AND p.polname = 'ball_event_insert'
                           AND pg_get_expr(p.polwithcheck, p.polrelid) LIKE '%my\\_child\\_fixtures%')
       THEN 'OK' ELSE 'PROBLEM' END                             AS "A parent reads his child's side's balls",
  -- db/101: a team post and its notice reach the side only; a boy on a
  -- fixture's sheet, and his guardians, read that fixture's plan.
  CASE WHEN to_regprocedure('news_sheet_reach(uuid,uuid,text)') IS NOT NULL
        AND to_regprocedure('news_team_notice_reach(uuid)') IS NOT NULL
        AND to_regprocedure('news_notice_sheet(uuid,uuid,text)') IS NOT NULL
        AND (SELECT bool_and(p.prosecdef) FROM pg_proc p
              WHERE p.oid IN (to_regprocedure('news_sheet_reach(uuid,uuid,text)'), to_regprocedure('news_team_notice_reach(uuid)'),
                              to_regprocedure('news_notice_sheet(uuid,uuid,text)')))
        AND has_function_privilege('scrbrd_app', to_regprocedure('news_sheet_reach(uuid,uuid,text)'), 'EXECUTE')
        AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                         WHERE p.oid IN (to_regprocedure('news_sheet_reach(uuid,uuid,text)'), to_regprocedure('news_team_notice_reach(uuid)'),
                                         to_regprocedure('news_notice_sheet(uuid,uuid,text)'))
                           AND x.grantee = 0 AND x.privilege_type = 'EXECUTE')
        AND (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND cmd = 'SELECT'
              AND ((permissive = 'RESTRICTIVE' AND (tablename, policyname) IN
                     (('news_post', 'news_post_team_side'), ('notification', 'notification_team_side')))
                OR (permissive = 'PERMISSIVE' AND (tablename, policyname) IN
                     (('news_post', 'news_post_read_sheet'), ('notification', 'notification_read_sheet'))))) = 4
        AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'news_post'
                     AND policyname = 'news_post_plan_side' AND qual LIKE '%news_sheet_reach(%')
       THEN 'OK' ELSE 'PROBLEM' END                             AS "A team post is the side's; the sheet reads its plan",
  -- db/102: a module hidden from a named person is read by that school's
  -- managers and by him, and its reason only through its function.
  CASE WHEN EXISTS (SELECT 1 FROM pg_policy p
                     WHERE p.polrelid = to_regclass('feature_suppression') AND p.polname = 'feature_suppression_read'
                       AND pg_get_expr(p.polqual, p.polrelid) LIKE '%(person_id = app_user_id())%school.feature.manage%')
        AND to_regprocedure('feature_suppression_reason(uuid)') IS NOT NULL
        AND has_function_privilege('scrbrd_app', to_regprocedure('feature_suppression_reason(uuid)'), 'EXECUTE')
        AND NOT has_column_privilege('scrbrd_app', to_regclass('feature_suppression'), 'reason', 'SELECT')
       THEN 'OK' ELSE 'PROBLEM' END                             AS "Who a module is hidden from is the school's",
  -- db/103: a live plan's author is named to the plan's readers, and only the
  -- name, only for a plan (SCRBRD-138 phase B's byline, CSA SG-9).
  CASE WHEN to_regprocedure('plan_author_name(uuid)') IS NOT NULL
        AND (SELECT prosecdef AND provolatile = 's' FROM pg_proc WHERE oid = to_regprocedure('plan_author_name(uuid)'))
        AND coalesce(pg_get_functiondef(to_regprocedure('plan_author_name(uuid)')), '') LIKE '%news_plan_reach(%'
        AND coalesce(pg_get_functiondef(to_regprocedure('plan_author_name(uuid)')), '') LIKE '%news_sheet_reach(n.fixture_id%'
        AND coalesce(pg_get_functiondef(to_regprocedure('plan_author_name(uuid)')), '') LIKE '%n.kind = ''plan''%'
        AND has_function_privilege('scrbrd_app', to_regprocedure('plan_author_name(uuid)'), 'EXECUTE')
        AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                         WHERE p.oid = to_regprocedure('plan_author_name(uuid)')
                           AND x.grantee = 0 AND x.privilege_type = 'EXECUTE')
       THEN 'OK' ELSE 'PROBLEM' END                             AS "A plan names its author to the side",
  -- db/104: a score keeps its assessor and is withdrawn, never overwritten by
  -- a colleague; a coaching point is a note, written by its function alone.
  CASE WHEN to_regclass('player_skill_standing') IS NOT NULL
        AND EXISTS (SELECT 1 FROM pg_index i WHERE i.indexrelid = to_regclass('player_skill_standing')
                       AND i.indisunique AND i.indpred IS NOT NULL)
        AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'player_skill_keeps_its_assessor' AND tgenabled = 'O')
        AND EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name = 'development_note' AND column_name = 'evidence_read')
        AND to_regprocedure('coaching_point_write(uuid,uuid,text,jsonb)') IS NOT NULL
        AND to_regprocedure('skill_withdraw(uuid,text)') IS NOT NULL
        AND to_regprocedure('note_withdraw(uuid)') IS NOT NULL
        AND (SELECT bool_and(p.prosecdef) FROM pg_proc p
              WHERE p.oid IN (to_regprocedure('coaching_point_write(uuid,uuid,text,jsonb)'),
                              to_regprocedure('skill_withdraw(uuid,text)'), to_regprocedure('note_withdraw(uuid)')))
        AND has_function_privilege('scrbrd_app', to_regprocedure('coaching_point_write(uuid,uuid,text,jsonb)'), 'EXECUTE')
        AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                         WHERE p.oid IN (to_regprocedure('coaching_point_write(uuid,uuid,text,jsonb)'),
                                         to_regprocedure('skill_withdraw(uuid,text)'), to_regprocedure('note_withdraw(uuid)'))
                           AND x.grantee = 0 AND x.privilege_type = 'EXECUTE')
        AND (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND permissive = 'RESTRICTIVE'
              AND (tablename, policyname) IN (('player_skill', 'player_skill_not_support'),
                                              ('development_note', 'development_note_not_support'),
                                              ('development_note', 'development_note_not_platform'),
                                              ('development_note', 'development_note_plain_insert'))) = 4
       THEN 'OK' ELSE 'PROBLEM' END                             AS "A score keeps its assessor; a point is a note",
  -- db/105: a target is written by its functions alone and read under the
  -- boy's development tier; the side's plan is keyed to the library; the
  -- register takes no health word.
  CASE WHEN to_regclass('development_target') IS NOT NULL
        AND to_regclass('training_session_drill') IS NOT NULL
        AND (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('development_target'))
        AND (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('training_session_drill'))
        AND NOT has_table_privilege('scrbrd_app', to_regclass('development_target'), 'INSERT')
        AND NOT has_table_privilege('scrbrd_app', to_regclass('development_target'), 'UPDATE')
        AND to_regprocedure('target_set(uuid,text,text,integer,date,uuid,uuid)') IS NOT NULL
        AND to_regprocedure('target_withdraw(uuid,text)') IS NOT NULL
        AND (SELECT bool_and(p.prosecdef) FROM pg_proc p
              WHERE p.oid IN (to_regprocedure('target_set(uuid,text,text,integer,date,uuid,uuid)'),
                              to_regprocedure('target_withdraw(uuid,text)')))
        AND has_function_privilege('scrbrd_app', to_regprocedure('target_set(uuid,text,text,integer,date,uuid,uuid)'), 'EXECUTE')
        AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                         WHERE p.oid IN (to_regprocedure('target_set(uuid,text,text,integer,date,uuid,uuid)'),
                                         to_regprocedure('target_withdraw(uuid,text)'))
                           AND x.grantee = 0 AND x.privilege_type = 'EXECUTE')
        AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'training_session_drill_from_the_library' AND tgenabled = 'O')
        AND EXISTS (SELECT 1 FROM role_capability WHERE role = 'teammanager' AND capability = 'team.training.run')
        AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'training_attendance'
                     AND policyname = 'training_attendance_insert' AND with_check LIKE '%team.training.run%')
        AND (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND permissive = 'RESTRICTIVE'
              AND (tablename, policyname) IN (('development_target', 'development_target_not_support'),
                                              ('training_attendance', 'training_attendance_no_health_word'),
                                              ('training_attendance', 'training_attendance_no_health_word_update'))) = 3
       THEN 'OK' ELSE 'PROBLEM' END                             AS "A target is the coach's; the plan is the side's",
  -- db/106: a family reads its side's fixtures, trips and training, asked
  -- about her child through the reach helpers, never the all-zeros person
  -- (REACH R-A).
  CASE WHEN (SELECT count(*) FROM pg_proc p
              WHERE p.prosecdef
                AND p.oid IN (to_regprocedure('side_reach(text,uuid,text,uuid)'), to_regprocedure('fixture_end_reach(text,uuid,uuid,text)'),
                              to_regprocedure('fixture_reach(text,uuid)'), to_regprocedure('my_fixture_ends(text)'),
                              to_regprocedure('my_sides(text)'), to_regprocedure('match_away_school(uuid)'),
                              to_regprocedure('match_away_team(uuid)'))) = 7
        AND has_function_privilege('scrbrd_app', to_regprocedure('my_fixture_ends(text)'), 'EXECUTE')
        AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                         WHERE p.oid IN (to_regprocedure('side_reach(text,uuid,text,uuid)'), to_regprocedure('fixture_end_reach(text,uuid,uuid,text)'),
                                         to_regprocedure('fixture_reach(text,uuid)'), to_regprocedure('my_fixture_ends(text)'),
                                         to_regprocedure('my_sides(text)'))
                           AND x.grantee = 0 AND x.privilege_type = 'EXECUTE')
        AND (SELECT count(*) FROM pg_policy p
              WHERE p.polcmd = 'r' AND p.polpermissive
                AND (p.polrelid, p.polname) IN ((to_regclass('match'), 'match_read'), (to_regclass('trip'), 'trip_read'),
                                                (to_regclass('training_session'), 'training_session_read'),
                                                (to_regclass('match_toss'), 'match_toss_read'),
                                                (to_regclass('match_official'), 'match_official_read'),
                                                (to_regclass('match_weather'), 'match_weather_read'),
                                                (to_regclass('match_conditions'), 'match_conditions_read'))
                AND pg_get_expr(p.polqual, p.polrelid) ~ '(my_fixture_ends|my_sides)\\(') = 7
        AND NOT EXISTS (SELECT 1 FROM pg_policy p
                         WHERE p.polrelid = to_regclass('match') AND p.polname = 'match_read'
                           AND pg_get_expr(p.polqual, p.polrelid) LIKE '%00000000-0000-0000-0000-000000000000%')
       THEN 'OK' ELSE 'PROBLEM' END                             AS "A family reads its side's fixtures",
  -- db/107: the officials register is its keeper's (and an official's own
  -- row); everybody else reads the panel by name and grade through
  -- official_panel(). A school's grant note is its own and the platform's.
  CASE WHEN to_regclass('official') IS NOT NULL
        AND to_regprocedure('official_panel(uuid)') IS NOT NULL
        AND to_regprocedure('official_conflict(uuid,uuid)') IS NOT NULL
        AND to_regprocedure('app_enrolled_at(uuid)') IS NOT NULL
        AND EXISTS (SELECT 1 FROM pg_policy p
                     WHERE p.polrelid = to_regclass('official') AND p.polname = 'official_read'
                       AND pg_get_expr(p.polqual, p.polrelid) LIKE '%officiating.registry.manage%'
                       AND pg_get_expr(p.polqual, p.polrelid) NOT LIKE '%app_enrolled()%')
        AND EXISTS (SELECT 1 FROM pg_policy p
                     WHERE p.polrelid = to_regclass('official_accreditation') AND p.polname = 'official_accreditation_read'
                       AND pg_get_expr(p.polqual, p.polrelid) NOT LIKE '%app_enrolled()%')
        AND EXISTS (SELECT 1 FROM pg_policy p
                     WHERE p.polrelid = to_regclass('feature_grant') AND p.polname = 'feature_grant_read'
                       AND pg_get_expr(p.polqual, p.polrelid) LIKE '%app_enrolled_at(school_id)%')
        AND (SELECT bool_and(p.prosecdef) FROM pg_proc p
              WHERE p.oid IN (to_regprocedure('official_panel(uuid)'), to_regprocedure('official_conflict(uuid,uuid)'),
                              to_regprocedure('app_enrolled_at(uuid)')))
        AND has_function_privilege('scrbrd_app', to_regprocedure('official_panel(uuid)'), 'EXECUTE')
        AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                         WHERE p.oid IN (to_regprocedure('official_panel(uuid)'), to_regprocedure('official_conflict(uuid,uuid)'),
                                         to_regprocedure('app_enrolled_at(uuid)'))
                           AND x.grantee = 0 AND x.privilege_type = 'EXECUTE')
       THEN 'OK' ELSE 'PROBLEM' END                             AS "The officials register is its keeper's",
  -- db/108: a pupil's player role names his side, as a coach's does.
  CASE WHEN EXISTS (SELECT 1 FROM pg_constraint c
                     WHERE c.conrelid = to_regclass('role_assignment')
                       AND c.conname = 'role_assignment_player_team_scoped' AND c.contype = 'c' AND c.convalidated)
        AND NOT EXISTS (SELECT 1 FROM role_assignment WHERE role = 'player' AND team_code IS NULL AND active)
        AND to_regprocedure('role_request_grant_as(uuid,uuid,text,uuid,text)') IS NOT NULL
        AND (SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('role_request_grant_as(uuid,uuid,text,uuid,text)'))
              LIKE '%IF r.role = ''player'' AND v_team IS NULL THEN%'
       THEN 'OK' ELSE 'PROBLEM' END                             AS "A pupil is a pupil of a side",
  -- db/109: every ending of a guardian link is recorded with a kind (and the
  -- office's reason), read by the office and never by the guardian or the
  -- DSO by standing; db/08's door without a kind or a reason is closed.
  -- db/116 (READERS Q2) re-wrote the read policy to guardian.link.manage
  -- alone: no auditor reads the office's reason.
  CASE WHEN to_regclass('guardian_link_ending') IS NOT NULL
        AND (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('guardian_link_ending'))
        AND EXISTS (SELECT 1 FROM pg_policy p
                     WHERE p.polrelid = to_regclass('guardian_link_ending') AND p.polname = 'guardian_link_ending_read'
                       AND pg_get_expr(p.polqual, p.polrelid) LIKE '%app_user_id()%guardian.link.manage%')
        AND NOT has_table_privilege('scrbrd_app', to_regclass('guardian_link_ending'), 'INSERT')
        AND has_function_privilege('scrbrd_app', to_regprocedure('guardian_link_revoke(uuid,text,text)'), 'EXECUTE')
        AND NOT has_function_privilege('scrbrd_app', to_regprocedure('guardian_link_revoke(uuid,uuid,text)'), 'EXECUTE')
        AND has_function_privilege('scrbrd_app', to_regprocedure('guardian_link_ending_notice_is_mine(uuid)'), 'EXECUTE')
        AND EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'notification' AND policyname = 'notification_link_ended')
        AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'role_assignment_ending_links' AND tgenabled = 'O')
        AND EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'guardian_link_ending'
                     AND policyname = 'guardian_link_ending_not_platform' AND permissive = 'RESTRICTIVE')
       THEN 'OK' ELSE 'PROBLEM' END                             AS "A link's ending is the office's to read",
  -- db/110: a draft plan is changed and thrown away by its author; a sent
  -- plan is kept, and not changed while it is out (Kameel, 15 Oct).
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'news_post' AND column_name = 'first_sent_at')
        AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'news_post_plan_drafts' AND tgenabled = 'O'
                     AND tgfoid = to_regprocedure('news_post_plan_drafts()'))
        AND coalesce(pg_get_functiondef(to_regprocedure('news_plan_discard(uuid)')), '') LIKE '%n.first_sent_at IS NOT NULL%'
        AND has_function_privilege('scrbrd_app', to_regprocedure('news_plan_discard(uuid)'), 'EXECUTE')
        AND NOT has_function_privilege('scrbrd_app', to_regprocedure('news_post_plan_drafts()'), 'EXECUTE')
        AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                         WHERE p.oid IN (to_regprocedure('news_plan_discard(uuid)'), to_regprocedure('news_post_plan_drafts()'))
                           AND x.grantee = 0 AND x.privilege_type = 'EXECUTE')
        AND NOT has_table_privilege('scrbrd_app', to_regclass('news_post'), 'DELETE')
       THEN 'OK' ELSE 'PROBLEM' END                             AS "A draft plan is its author's to change or throw away",
  -- db/111: the physio's injury record (GA-I19 slice A, with SG-12's injury
  -- half): two doors and the worklist, the review table hidden from support,
  -- the application writing neither table directly, and the DSO's watch.
  CASE WHEN to_regclass('injury_review') IS NOT NULL AND to_regclass('injury_review_masked') IS NOT NULL
        AND to_regprocedure('injury_record(uuid,text,text,date,boolean,date,date,boolean,text,uuid)') IS NOT NULL
        AND to_regprocedure('injury_review_record(uuid,text,boolean,date,date,text)') IS NOT NULL
        AND to_regprocedure('injury_worklist()') IS NOT NULL
        AND to_regprocedure('injury_serious_watch()') IS NOT NULL
        AND (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('injury_review'))
        AND EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'injury_review'
                       AND policyname = 'injury_review_not_support' AND permissive = 'RESTRICTIVE')
        AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass('injury') AND tgname = 'injury_serious_watch')
        AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass('injury_review') AND tgname = 'injury_apply_review')
        AND NOT has_table_privilege('scrbrd_app', to_regclass('injury'), 'INSERT')
        AND NOT has_table_privilege('scrbrd_app', to_regclass('injury_review'), 'INSERT')
        AND has_function_privilege('scrbrd_app', to_regprocedure('injury_record(uuid,text,text,date,boolean,date,date,boolean,text,uuid)'), 'EXECUTE')
        AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                         WHERE p.oid = to_regprocedure('injury_record(uuid,text,text,date,boolean,date,date,boolean,text,uuid)')
                           AND x.grantee = 0 AND x.privilege_type = 'EXECUTE')
       THEN 'OK' ELSE 'PROBLEM' END                             AS "The physio records and reviews an injury",
  -- db/112: a moved pupil's player role follows his side (SR-1), never to no
  -- side; and a boy playing up reads the balls of the match he is picked for.
  -- Only to_regprocedure()/to_regclass(), so the row reads PROBLEM rather
  -- than failing the query on a database without db/112.
  CASE WHEN to_regprocedure('player_assignment_follows_side()') IS NOT NULL
        AND to_regprocedure('player_assignment_carry(uuid,uuid,text)') IS NOT NULL
        AND to_regprocedure('player_assignment_disagreements()') IS NOT NULL
        AND to_regprocedure('my_own_sheet_fixtures()') IS NOT NULL
        AND EXISTS (SELECT 1 FROM pg_trigger t
                     WHERE t.tgrelid = to_regclass('player') AND t.tgname = 'player_assignment_follows_side'
                       AND t.tgfoid = to_regprocedure('player_assignment_follows_side()') AND t.tgenabled = 'O')
        AND EXISTS (SELECT 1 FROM pg_policy p
                     WHERE p.polrelid = to_regclass('ball_event') AND p.polname = 'ball_event_read'
                       AND pg_get_expr(p.polqual, p.polrelid) LIKE '%my_child_fixtures()%'
                       AND pg_get_expr(p.polqual, p.polrelid) LIKE '%my_own_sheet_fixtures()%')
        AND has_function_privilege('scrbrd_app', to_regprocedure('my_own_sheet_fixtures()'), 'EXECUTE')
        AND NOT has_function_privilege('scrbrd_app', to_regprocedure('player_assignment_carry(uuid,uuid,text)'), 'EXECUTE')
        AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                         WHERE p.oid IN (to_regprocedure('player_assignment_carry(uuid,uuid,text)'),
                                         to_regprocedure('player_assignment_follows_side()'),
                                         to_regprocedure('my_own_sheet_fixtures()'))
                           AND x.grantee = 0 AND x.privilege_type = 'EXECUTE')
        -- no live player role of a boy's own account sits on another side
        AND NOT EXISTS (SELECT 1 FROM role_assignment a
                          JOIN app_user u ON u.id = a.person_id
                          JOIN player p ON p.id = u.player_id AND p.school_id = a.school_id
                         WHERE a.role = 'player' AND a.active AND a.fixture_id IS NULL AND a.expires_at IS NULL
                           AND a.team_code IS DISTINCT FROM p.team_code)
       THEN 'OK' ELSE 'PROBLEM' END                             AS "A moved pupil follows his new side",
  -- db/113: a void takes back the milestone and breach notices it falsified,
  -- and a re-reached mark returns in place (GA-I36 A2, NOTIFICATIONS S5).
  CASE WHEN to_regprocedure('milestone_retract()') IS NOT NULL
        AND to_regprocedure('bowling_breach_retract()') IS NOT NULL
        AND to_regprocedure('notification_unretract(uuid)') IS NOT NULL
        AND to_regprocedure('milestone_notify_as(uuid,text,uuid,smallint,integer,boolean)') IS NOT NULL
        AND to_regprocedure('milestone_still_holds(uuid,text,uuid,smallint,integer)') IS NOT NULL
       THEN 'OK' ELSE 'PROBLEM' END                             AS "A correction takes back what it falsified",
  -- db/116: who reads a child's data (READERS_child_data Q2–Q16, 21 Oct
  -- 2026, and the red-team's A1, A5, A7). audit.read opens no reason; the
  -- coach, the league and the transport coordinator read through logged
  -- doors; a departed boy's clinical record is cut from staff; a pupil
  -- scorer reads the sheet; the passport carries no rating and opens to
  -- the family, a coach or the office; a pupil holds no ID-number read.
  CASE WHEN NOT EXISTS (SELECT 1 FROM role_capability WHERE (role, capability) IN
                          (('selfaccess', 'player.identity.read'), ('transportcoordinator', 'player.emergency.read'),
                           ('competitionadmin', 'discipline.read'), ('coach', 'discipline.read')))
        AND (SELECT count(*) FROM role_capability
              WHERE capability IN ('competition.discipline.read', 'transport.manifest.read', 'discipline.side.read')) = 6
        AND NOT EXISTS (SELECT 1 FROM pg_policies
                         WHERE schemaname = 'public' AND cmd IN ('SELECT', 'ALL') AND qual LIKE '%audit.read%'
                           AND (tablename, policyname) NOT IN (('access_log', 'access_log_read'), ('scoring_audit', 'audit_read'),
                                                               ('support_access', 'support_access_read'),
                                                               ('scorebook_import', 'scorebook_import_read'),
                                                               ('scorebook_import_revision', 'scorebook_import_revision_read')))
        AND (SELECT count(*) FROM pg_policies
              WHERE schemaname = 'public' AND permissive = 'RESTRICTIVE'
                AND policyname IN ('injury_departed_cut', 'injury_review_departed_cut', 'player_pupil_sheet_only')) = 3
        AND to_regprocedure('competition_discipline_records(uuid)') IS NOT NULL
        AND to_regprocedure('side_discipline_records(uuid)') IS NOT NULL
        AND (SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('passport(uuid)')) !~ '(player_skill|''rating'')'
        AND (SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('passport_open(uuid)')) NOT LIKE '%player.profile.read%'
        AND NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) x
                         WHERE p.oid IN (to_regprocedure('passport(uuid)'), to_regprocedure('passport_name(uuid)'),
                                         to_regprocedure('passport_open(uuid)'), to_regprocedure('trip_contacts(uuid)'),
                                         to_regprocedure('scouting_candidates()'))
                           AND x.grantee = 0 AND x.privilege_type = 'EXECUTE')
        AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notification_kind_known'
                       AND pg_get_constraintdef(oid) LIKE '%compromise%')
       THEN 'OK' ELSE 'PROBLEM' END                             AS "Who reads a child's data",
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

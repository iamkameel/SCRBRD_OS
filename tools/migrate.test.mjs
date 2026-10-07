// The migrator refuses --reset against anything that is not a local database.
// Falsified once: with the host check removed, the first assertion goes red
// because psql is spawned and fails to connect (exit 1), not refused (exit 2).
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATE = join(HERE, "migrate.mjs");
let passes = 0, fails = 0;
const ok = (label, cond, detail = "") => { console.log(`${cond ? "✓" : "✗"} ${label}${cond || !detail ? "" : `\n    ${detail}`}`); if (cond) passes++; else fails++; };

const run = (url, env = {}) => spawnSync(process.execPath, [MIGRATE, "--reset"], {
  encoding: "utf8", timeout: 20000,
  env: { ...process.env, DATABASE_URL: url, I_UNDERSTAND_THIS_DESTROYS_PRODUCTION: "", ...env },
});

const REMOTE = "postgres://postgres.abc:secret@aws-1-eu-west-1.pooler.supabase.com:5432/postgres";
const remote = run(REMOTE);
ok("--reset against a managed host is refused with exit 2", remote.status === 2, `status ${remote.status}`);
ok("the refusal names the host", /aws-1-eu-west-1\.pooler\.supabase\.com/.test(remote.stderr), remote.stderr);
ok("the refusal does not leak the password", !/secret/.test(remote.stderr + remote.stdout));
ok("the refusal points at the two right paths", /--reset-objects/.test(remote.stderr) && /db\/NN_\*\.sql/.test(remote.stderr));
ok("nothing was attempted against the database", !/Resetting schema/.test(remote.stdout));

const bad = run("not a url at all");
ok("an unparseable DATABASE_URL is refused too", bad.status === 2 && /unparseable/.test(bad.stderr), `status ${bad.status}`);

// The override is the only way past the guard; the guard is then not what
// stops the run (psql cannot reach that host), so the exit code is 1 not 2.
const forced = run(REMOTE, { I_UNDERSTAND_THIS_DESTROYS_PRODUCTION: "1" });
ok("the named override passes the guard", forced.status !== 2 && /Resetting schema/.test(forced.stdout), `status ${forced.status}\n    ${(forced.stdout + forced.stderr).slice(0, 300)}`);

// A local URL is exactly what LOCAL_HOSTS lets through, with no override
// needed. Past the guard it really does run --reset, so it must point at a
// port NOTHING listens on: port 1. Pointed at 5432 it dropped the developer's
// own database on every run of the unit suite wherever Postgres was up,
// under any other process using it (found 2026-09-26, a browser walk losing
// its tables mid-run). The run fails on psql's own connection refusal —
// never the guard's exit 2 — and the "Resetting schema" line, printed only
// past the guard, must appear.
const LOCAL = "postgres://scrbrd:scrbrd@127.0.0.1:1/scrbrd";
const local = run(LOCAL);
ok("a local DATABASE_URL is not refused by the guard", local.status !== 2 && /Resetting schema/.test(local.stdout),
   `status ${local.status}\n    ${(local.stdout + local.stderr).slice(0, 300)}`);

// --reset-objects is the MANAGED-host path, so a managed host is exactly
// where it must not run by default (GA-I02). It had no guard at all: against
// a remote URL it went straight to psql. Same rule as --reset, its own
// override, named for what it does.
const runObjects = (url, env = {}) => spawnSync(process.execPath, [MIGRATE, "--reset-objects"], {
  encoding: "utf8", timeout: 20000,
  env: { ...process.env, DATABASE_URL: url, I_UNDERSTAND_THIS_DESTROYS_PRODUCTION: "", I_UNDERSTAND_THIS_ERASES_EVERY_SCRBRD_RECORD: "", ...env },
});
const remoteObjects = runObjects(REMOTE);
ok("--reset-objects against a managed host is refused with exit 2", remoteObjects.status === 2, `status ${remoteObjects.status}`);
ok("...naming the host, not the password", /aws-1-eu-west-1\.pooler\.supabase\.com/.test(remoteObjects.stderr) && !/secret/.test(remoteObjects.stderr + remoteObjects.stdout), remoteObjects.stderr);
ok("...pointing at apply-NN for a real database", /--apply NN/.test(remoteObjects.stderr), remoteObjects.stderr);
ok("...with nothing attempted", !/Dropping this project's objects/.test(remoteObjects.stdout));
ok("--reset's override does not open --reset-objects", runObjects(REMOTE, { I_UNDERSTAND_THIS_DESTROYS_PRODUCTION: "1" }).status === 2);
const forcedObjects = runObjects(REMOTE, { I_UNDERSTAND_THIS_ERASES_EVERY_SCRBRD_RECORD: "1" });
ok("its own named override passes the guard", forcedObjects.status !== 2 && /Dropping this project's objects/.test(forcedObjects.stdout),
   `status ${forcedObjects.status}\n    ${(forcedObjects.stdout + forcedObjects.stderr).slice(0, 300)}`);
const localObjects = runObjects(LOCAL);
ok("a local DATABASE_URL is not refused by it", localObjects.status !== 2 && /Dropping this project's objects/.test(localObjects.stdout),
   `status ${localObjects.status}`);

// What it may drop: read from db/, and nothing it may not.
{
  const { projectObjects, teardownSql } = await import("./reset-objects.mjs");
  const o = projectObjects(join(HERE, "..", "db"));
  ok("the allowlist holds our tables, views, routines and the enum",
     o.tables.includes("news_post") && o.tables.includes("request_replay") && o.tables.includes("schema_migration")
     && o.views.length > 0 && o.routines.includes("app_can") && o.types.includes("session_state"));
  ok("...and no temporary table a migration made for its own use", !o.tables.includes("_db42_before") && !o.tables.includes("_dls_cells"));
  const sql = teardownSql(o);
  ok("the teardown carries the allowlist", /ours_tables\s+text\[\] := ARRAY\[[^\]]*'news_post'/.test(sql));
  ok("...and refuses first if somebody else's object depends on ours", sql.indexOf("refusing to reset") < sql.indexOf("EXECUTE format('DROP"));
}

console.log(`\nMIGRATE GUARD: ${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);

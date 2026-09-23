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
// needed. It still spawns psql against 127.0.0.1 — which is almost
// certainly not listening in a test environment — so the run itself may
// fail, but that must be psql's own connection failure, never the guard's
// exit 2, and the "Resetting schema" line (printed only past the guard)
// must appear.
const LOCAL = "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const local = run(LOCAL);
ok("a local DATABASE_URL is not refused by the guard", local.status !== 2 && /Resetting schema/.test(local.stdout),
   `status ${local.status}\n    ${(local.stdout + local.stderr).slice(0, 300)}`);

console.log(`\nMIGRATE GUARD: ${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);

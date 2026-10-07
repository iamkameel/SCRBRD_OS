#!/usr/bin/env node
/**
 * The managed-host reset touches only this project's objects (GA-I02).
 *
 * `migrate.mjs --reset-objects`, and section 1 of the rebuild bundle that
 * bundle-sql.mjs writes for Supabase's SQL Editor, used to drop every
 * non-extension table, view, routine and enum in `public` — another
 * application's included. This walk proves, in a disposable database of its
 * own, that somebody else's table, view, function, enum and sequence survive
 * both, that everything of ours goes, and that somebody else's object built
 * ON one of ours stops the reset before it drops anything.
 *
 * (That a remote host is refused by default is tools/migrate.test.mjs's: no
 * database needed.)
 *
 *   node tools/smoke-reset-objects.mjs
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { ownerUrl, dbName } from "./db-url.mjs";
import { projectObjects, teardownSql, migrationFiles } from "./reset-objects.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${d}` : ""); } };
const group = (t) => console.log("\n" + t);

// A database of the walk's own, beside this worktree's, dropped at the end.
const SCRATCH = `${dbName()}_reset_walk`.slice(0, 63);
const scratchUrl = (() => { const u = new URL(ownerUrl()); u.pathname = `/${SCRATCH}`; return u.toString(); })();
const admin = new pg.Client({ connectionString: ownerUrl() });
await admin.connect();
const recreate = async () => {
  await admin.query(`drop database if exists ${SCRATCH} with (force)`);
  await admin.query(`create database ${SCRATCH}`);
};

const migrate = (...args) => spawnSync(process.execPath, [join(ROOT, "tools", "migrate.mjs"), ...args], {
  encoding: "utf8", env: { ...process.env, DATABASE_URL: scratchUrl }, maxBuffer: 64 * 1024 * 1024 });
const psql = (...args) => spawnSync("psql", [scratchUrl, "-v", "ON_ERROR_STOP=1", "-q", "-X", ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

// Somebody else's: a table with a row, a view over it, a function, an enum, a
// sequence. None is named by any db/ file.
const SENTINELS = `
  create table not_ours_table (id int primary key, note text);
  insert into not_ours_table values (1, 'still here');
  create view not_ours_view as select id, note from not_ours_table;
  create function not_ours_fn() returns int language sql as 'select 42';
  create type not_ours_enum as enum ('kept');
  create sequence not_ours_seq start 7;`;
const SENTINEL_NAMES = ["not_ours_table", "not_ours_view", "not_ours_fn", "not_ours_enum", "not_ours_seq"];

/** All five, working; false (not a throw) when any has gone. @param {pg.Client} c */
const sentinelsAlive = async (c) => {
  try {
    const r = await c.query(`select (select note from not_ours_view where id = 1) as note, not_ours_fn() as fn,
                                    'kept'::not_ours_enum::text as e, nextval('not_ours_seq') as s`);
    return r.rows[0]?.note === "still here" && r.rows[0]?.fn === 42 && r.rows[0]?.e === "kept" && Number(r.rows[0]?.s) >= 7;
  } catch (/** @type {any} */ e) { console.log(`    (${e.message})`); return false; }
};
const withScratch = async (/** @type {(c: pg.Client) => Promise<any>} */ fn) => {
  const c = new pg.Client({ connectionString: scratchUrl });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
};
// Every non-extension object left in public, by name.
const leftInPublic = (/** @type {pg.Client} */ c) => c.query(`
  select relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and relkind in ('r','p','v','m','S')
     and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype in ('e','a','i'))
  union select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  union select typname from pg_type t join pg_namespace n on n.oid = t.typnamespace
   where n.nspname = 'public' and t.typtype in ('e','d')
     and not exists (select 1 from pg_depend d where d.objid = t.oid and d.deptype = 'e')`).then((r) => r.rows.map((x) => x.name).sort());
const oids = (/** @type {pg.Client} */ c) => c.query(`select 'news_post'::regclass::oid::int as t, 'app_user_id()'::regprocedure::oid::int as f`).then((r) => r.rows[0]);
const N = migrationFiles(join(ROOT, "db")).length;

try {
  await recreate();
  const first = migrate();
  ok("every migration applies to the scratch database", first.status === 0, first.stderr.slice(-400));
  await withScratch((c) => c.query(SENTINELS));

  group("The teardown alone: ours gone, somebody else's left, nothing else");
  {
    const t = psql("-c", teardownSql(projectObjects(join(ROOT, "db"))));
    ok("the teardown runs", t.status === 0, (t.stdout + t.stderr).slice(-400));
    const left = await withScratch(leftInPublic);
    ok("what is left in public is exactly somebody else's five objects", JSON.stringify(left) === JSON.stringify([...SENTINEL_NAMES].sort()),
       JSON.stringify(left.filter((n) => !SENTINEL_NAMES.includes(n)).slice(0, 20)));
    ok("...and they still work: the row, the view, the function, the enum, the sequence", await withScratch(sentinelsAlive));
  }

  group("migrate.mjs --reset-objects: drops ours, rebuilds ours, keeps theirs");
  {
    const again = migrate();
    ok("the migrations apply again after the teardown", again.status === 0, again.stderr.slice(-400));
    const before = await withScratch(oids);
    const r = migrate("--reset-objects");
    ok("--reset-objects runs on a local database", r.status === 0, (r.stdout + r.stderr).slice(-400));
    const after = await withScratch(oids);
    ok("our table and our function were dropped and made anew", before.t !== after.t && before.f !== after.f, JSON.stringify({ before, after }));
    ok("...the ledger rebuilt in full", (await withScratch((c) => c.query(`select count(*)::int n from schema_migration`))).rows[0].n === N);
    ok("somebody else's table, view, function, enum and sequence survive", await withScratch(sentinelsAlive));
  }

  group("Somebody else's object built on one of ours stops the reset before anything is dropped");
  {
    await withScratch((c) => c.query(`create view not_ours_over_ours as select id from news_post`));
    const before = await withScratch(oids);
    const r = migrate("--reset-objects");
    ok("refused", r.status !== 0);
    ok("...naming the object", /refusing to reset/.test(r.stderr + r.stdout) && /not_ours_over_ours/.test(r.stderr + r.stdout), (r.stderr + r.stdout).slice(-300));
    const after = await withScratch(oids);
    ok("...with nothing of ours dropped", before.t === after.t && before.f === after.f);
    await withScratch((c) => c.query(`drop view if exists not_ours_over_ours`));
  }

  group("The rebuild bundle's teardown keeps them too (Supabase's SQL Editor path)");
  {
    // Fresh sentinels, so this group stands on its own whatever came before.
    await withScratch((c) => c.query(`drop view if exists not_ours_view; drop table if exists not_ours_table;
      drop function if exists not_ours_fn(); drop type if exists not_ours_enum; drop sequence if exists not_ours_seq; ${SENTINELS}`));
    const b = spawnSync(process.execPath, [join(ROOT, "tools", "bundle-sql.mjs")], { encoding: "utf8" });
    ok("the bundle is written", b.status === 0, b.stderr);
    const bundle = readFileSync(join(ROOT, "scrbrd-supabase-rebuild.sql"), "utf8");
    ok("its section 1 is the migrator's teardown, verbatim", bundle.includes(teardownSql(projectObjects(join(ROOT, "db")))));
    const r = psql("-f", join(ROOT, "scrbrd-supabase-rebuild.sql"));
    ok("the bundle runs over a database that has ours and theirs", r.status === 0, r.stderr.slice(-400));
    ok("somebody else's objects survive it", await withScratch(sentinelsAlive));
    ok("...the ledger is whole", (await withScratch((c) => c.query(`select count(*)::int n from schema_migration`))).rows[0].n === N);
    ok("...and the demonstration data is there", (await withScratch((c) => c.query(`select count(*)::int n from player`))).rows[0].n > 0);
    const m = migrate();
    ok("the migrator agrees with the bundle afterwards: nothing to apply", m.status === 0 && /\b0 applied\b/.test(m.stdout), m.stdout.slice(-200));
  }
} catch (e) {
  ok(`the reset walk threw: ${e.message?.slice(0, 200)}`, false);
} finally {
  await admin.query(`drop database if exists ${SCRATCH} with (force)`).catch(() => {});
  await admin.end().catch(() => {});
}
console.log(`\n${"─".repeat(52)}\nRESET-OBJECTS SMOKE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

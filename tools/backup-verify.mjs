#!/usr/bin/env node
/**
 * The backup-and-restore drill (docs/pilot/BACKUP_RESTORE.md), as one tool.
 *
 * The database holds minors' personal data, so a backup that has never been
 * restored is a hope, not a backup. This tool takes the dump, restores it into
 * a throwaway LOCAL database, and proves the copy is the database it came from:
 * the same migrations (the ledger against db/SHIPPED.sha256) and the same
 * number of rows in every table as at the moment of the dump.
 *
 *   node tools/backup-verify.mjs dump --out FILE.dump --counts FILE.counts.json
 *       READ ONLY. Opens one read-only, repeatable-read transaction on the
 *       source, counts every table in `public` and reads the ledger, then runs
 *       pg_dump (custom format, schema `public`, which holds schema_migration)
 *       inside that SAME snapshot, so the counts describe exactly what is in
 *       the dump even while scorers are writing. Records the dump's sha256.
 *
 *   node tools/backup-verify.mjs counts --out FILE.counts.json
 *       READ ONLY. The counts and ledger alone, with no dump.
 *
 *   node tools/backup-verify.mjs restore --from FILE.dump
 *       WRITES. Restores the dump into the target database, which must be on
 *       this machine and must have no tables in `public` yet. Refused (exit 2)
 *       for any other host: this tool never restores into production.
 *
 *   node tools/backup-verify.mjs verify --counts FILE.counts.json [--dump FILE.dump]
 *       READ ONLY. Compares the target's ledger with db/SHIPPED.sha256 and with
 *       the ledger at dump time, and every table's row count with the counts
 *       file (and, given --dump, the file's sha256 with the one recorded).
 *       Exit 1 on any mismatch.
 *
 * The database is the repository's usual one (tools/db-url.mjs): DATABASE_URL
 * if set, otherwise SCRBRD_DB on the local cluster. Point a single command at
 * production with `DATABASE_URL="$SCRBRD_PROD_OWNER_URL" node tools/...` and
 * never export it. Nothing here prints a connection string, a remote host
 * name or a row: only table names, counts, migration names and hashes.
 *
 * Exit codes: 0 all good · 1 a mismatch or a failure · 2 refused (a write to a
 * host that is not local, a target that is not empty, a usage error).
 */
import { createHash } from "node:crypto";
import { chmodSync, createReadStream, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ownerUrl } from "./db-url.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ── Pure parts (tools/backup-verify.test.mjs) ─────────────────────

/** The hosts tools/migrate.mjs's --reset guard treats as this machine. */
export const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "db"]);

/**
 * Is this connection string a database on this machine? A TCP host from
 * LOCAL_HOSTS, or a Unix socket (no host, or a `host=/path` parameter).
 * Anything unparseable is NOT local.
 * @param {string} url
 */
export function isLocalUrl(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (!/^postgres(ql)?:$/.test(u.protocol)) return false;
  const param = u.searchParams.get("host");
  if (u.hostname === "") return param == null || param.startsWith("/");
  if (param != null && !param.startsWith("/") && !LOCAL_HOSTS.has(param)) return false;
  return LOCAL_HOSTS.has(u.hostname);
}

/**
 * How a database is named in output: host and database for a local one, and
 * nothing that identifies a remote one (its host carries the project's region
 * and, in a pooler user name, its reference).
 * @param {string} url
 */
export function describeUrl(url) {
  if (!isLocalUrl(url)) return "a remote database";
  try {
    const u = new URL(url);
    return `local database "${decodeURIComponent(u.pathname.replace(/^\//, "")) || "(default)"}"`;
  } catch { return "a local database"; }
}

/**
 * db/SHIPPED.sha256 → Map of migration file name (no `db/`) → sha256.
 * @param {string} text
 */
export function parseShipped(text) {
  /** @type {Map<string, string>} */
  const m = new Map();
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const [hash, file] = t.split(/\s+/);
    if (!/^[0-9a-f]{64}$/.test(hash ?? "") || !file) throw new Error(`SHIPPED.sha256: unreadable line "${t}"`);
    m.set(file.replace(/^db\//, ""), hash);
  }
  return m;
}

/**
 * Differences between two ledgers (name → sha256), in words. `a` and `b` name
 * the two sides in each line. Empty when they are the same.
 * @param {Map<string,string>} a @param {Map<string,string>} b
 * @param {string} aName @param {string} bName
 */
export function compareLedgers(a, b, aName, bName) {
  /** @type {string[]} */
  const out = [];
  for (const [name, hash] of a) {
    const other = b.get(name);
    if (other == null) out.push(`${name}: in ${aName}, not in ${bName}`);
    else if (other !== hash) out.push(`${name}: hash differs (${aName} ${hash.slice(0, 12)}…, ${bName} ${other.slice(0, 12)}…)`);
  }
  for (const name of b.keys()) if (!a.has(name)) out.push(`${name}: in ${bName}, not in ${aName}`);
  return out.sort();
}

/**
 * Row counts at dump time against row counts now, in words. A table on one
 * side only is a difference too. Empty when every table matches.
 * @param {Record<string, number>} expected @param {Record<string, number>} actual
 */
export function compareCounts(expected, actual) {
  /** @type {string[]} */
  const out = [];
  for (const [t, n] of Object.entries(expected)) {
    if (!(t in actual)) out.push(`${t}: ${n} row(s) at dump time, table missing from the restored copy`);
    else if (actual[t] !== n) out.push(`${t}: ${n} row(s) at dump time, ${actual[t]} in the restored copy`);
  }
  for (const t of Object.keys(actual)) if (!(t in expected)) out.push(`${t}: not in the counts file, ${actual[t]} row(s) in the restored copy`);
  return out.sort();
}

/**
 * Every role a dump's schema script grants to, revokes from, or sets default
 * privileges for — the roles that must exist before the dump's ACLs restore.
 * pg_restore runs each object's GRANTs as one command, so one missing role
 * (Supabase's `anon`, say) would also lose that object's grant to scrbrd_app.
 * PUBLIC is not a role.
 * @param {string} script  `pg_restore --schema-only -f -` output
 */
export function rolesInAcl(script) {
  /** @type {Set<string>} */
  const roles = new Set();
  const name = /"((?:[^"]|"")+)"|([A-Za-z_][A-Za-z0-9_$]*)/g;
  const take = (/** @type {string} */ list) => {
    for (const m of list.matchAll(name)) {
      const r = m[1] != null ? m[1].replace(/""/g, '"') : m[2];
      if (r.toUpperCase() !== "PUBLIC" && !/^(GROUP|WITH|GRANTED|BY|CASCADE|RESTRICT|OPTION|CURRENT_USER|SESSION_USER|CURRENT_ROLE)$/i.test(r)) roles.add(r);
    }
  };
  for (const raw of script.split("\n")) {
    const line = raw.trim();
    if (!/^(GRANT|REVOKE|ALTER DEFAULT PRIVILEGES)\b/i.test(line)) continue;
    const forRole = line.match(/^ALTER DEFAULT PRIVILEGES FOR (?:ROLE|USER) (.+?) (?:IN SCHEMA|GRANT|REVOKE)\b/i);
    if (forRole) take(forRole[1]);
    const to = line.match(/\b(?:TO|FROM) (.+?)(?: WITH .*| GRANTED BY .*| CASCADE| RESTRICT)?;$/i);
    if (to) take(to[1]);
  }
  return [...roles].sort();
}

/**
 * A dump's table of contents (`pg_restore --list`) with the CREATE SCHEMA
 * public entry commented out. A dump of a database whose public schema was
 * dropped and made again (the migrator's --reset) carries that entry; one of a
 * stock public schema (Supabase's) does not. The target always has its own
 * public, so the entry could only fail. The schema's ACL and COMMENT stay.
 * @param {string} toc
 */
export function withoutPublicSchema(toc) {
  return toc.split("\n").map((l) => (/^\d+; \d+ \d+ SCHEMA - public /.test(l) ? `;${l}` : l)).join("\n");
}

/**
 * A counts file, checked for shape. Throws on anything else.
 * @param {string} text
 * @returns {{version: 1, takenAt: string, serverVersion: string, ledger: Record<string,string>, tables: Record<string,number>, dump?: {file: string, sha256: string, bytes: number}}}
 */
export function parseCounts(text) {
  const c = JSON.parse(text);
  if (c?.version !== 1) throw new Error("counts file: not version 1");
  if (typeof c.ledger !== "object" || c.ledger == null) throw new Error("counts file: no ledger");
  if (typeof c.tables !== "object" || c.tables == null || !Object.keys(c.tables).length) throw new Error("counts file: no tables");
  for (const [t, n] of Object.entries(c.tables)) if (!Number.isInteger(n) || n < 0) throw new Error(`counts file: ${t} has no whole count`);
  return c;
}

/** "16.13 (Ubuntu …)" or "pg_dump (PostgreSQL) 17.2" → 16 / 17. @param {string} s */
export const majorOf = (s) => Number((s.match(/(\d+)(?:\.\d+)?/) ?? [])[1] ?? NaN);

// ── The database side ─────────────────────────────────────────────

/** @param {string[]} argv */
function parseArgs(argv) {
  const [mode, ...rest] = argv;
  /** @type {Record<string, string>} */
  const opts = {};
  for (let i = 0; i < rest.length; i++) {
    const k = rest[i];
    if (!k.startsWith("--")) usage(`unexpected argument "${k}"`);
    const v = rest[i + 1];
    if (v == null || v.startsWith("--")) usage(`${k} needs a value`);
    opts[k.slice(2)] = v; i++;
  }
  return { mode, opts };
}

/** @param {string} [why] @returns {never} */
function usage(why) {
  if (why) console.error(`✗ ${why}`);
  console.error(`usage:
  node tools/backup-verify.mjs dump    --out FILE.dump --counts FILE.counts.json   (read only)
  node tools/backup-verify.mjs counts  --out FILE.counts.json                       (read only)
  node tools/backup-verify.mjs restore --from FILE.dump                             (local target only)
  node tools/backup-verify.mjs verify  --counts FILE.counts.json [--dump FILE.dump] (read only)`);
  process.exit(2);
}

/** @param {string} file */
const sha256File = (file) => new Promise((resolve, reject) => {
  const h = createHash("sha256");
  createReadStream(file).on("data", (d) => h.update(d)).on("end", () => resolve(h.digest("hex"))).on("error", reject);
});

/** @param {string} url */
async function connect(url) {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url, application_name: "scrbrd-backup-verify" });
  try { await client.connect(); }
  catch (e) {
    // The driver's message can carry the host; say only what kind of failure it was.
    const err = /** @type {{code?: string}} */ (e);
    console.error(`✗ could not connect to ${describeUrl(url)} (${err.code ?? "connection failed"})`);
    process.exit(1);
  }
  return client;
}

/**
 * The ledger and every table's exact row count, inside the caller's transaction.
 * @param {import("pg").Client} client
 */
async function snapshotFacts(client) {
  const { rows: [{ v }] } = await client.query("SELECT current_setting('server_version') AS v");
  const { rows: tables } = await client.query(`
    SELECT c.relname AS name FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')
     ORDER BY c.relname`);
  /** @type {Record<string, number>} */
  const counts = {};
  for (const { name } of tables) {
    const { rows: [{ n }] } = await client.query(`SELECT count(*)::bigint AS n FROM public."${String(name).replace(/"/g, '""')}"`);
    counts[name] = Number(n);
  }
  /** @type {Record<string, string>} */
  const ledger = {};
  if ("schema_migration" in counts) {
    const { rows } = await client.query("SELECT name, sha256 FROM public.schema_migration ORDER BY name");
    for (const r of rows) ledger[r.name] = r.sha256;
  }
  return { serverVersion: String(v), tables: counts, ledger };
}

/** @param {import("pg").Client} client */
async function beginReadOnly(client) {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  // A managed host may set either; a count over a big table, or the pause
  // while pg_dump picks up the snapshot, must not be cut off half-way.
  await client.query("SET LOCAL statement_timeout = 0");
  await client.query("SET LOCAL idle_in_transaction_session_timeout = 0");
}

/** @param {{out?: string, counts?: string}} opts @param {boolean} withDump */
async function takeCounts(opts, withDump) {
  const url = ownerUrl();
  const countsPath = withDump ? opts.counts : opts.out;
  if (!countsPath) usage(withDump ? "dump needs --counts FILE" : "counts needs --out FILE");
  if (withDump && !opts.out) usage("dump needs --out FILE");
  for (const p of [countsPath, withDump ? opts.out : null]) {
    if (p && existsSync(p)) { console.error(`✗ ${p} already exists; refusing to overwrite a backup`); process.exit(2); }
  }

  const client = await connect(url);
  try {
    await beginReadOnly(client);
    const facts = await snapshotFacts(client);
    let dump;
    if (withDump && opts.out) {
      const tool = spawnSync("pg_dump", ["--version"], { encoding: "utf8" });
      if (tool.status !== 0) { console.error("✗ pg_dump is not installed (RUNNING.md: postgresql-client)"); process.exit(1); }
      if (majorOf(tool.stdout.replace(/^\D+/, "")) < majorOf(facts.serverVersion)) {
        console.error(`✗ pg_dump is ${tool.stdout.trim()}, older than the server (${majorOf(facts.serverVersion)}). Install a pg_dump of that major version or newer.`);
        process.exit(1);
      }
      const { rows: [{ snap }] } = await client.query("SELECT pg_export_snapshot() AS snap");
      console.log(`Dumping ${describeUrl(url)} (schema public, custom format) in snapshot ${snap}…`);
      const r = spawnSync("pg_dump", ["--format=custom", "--schema=public", `--snapshot=${snap}`,
        "--no-password", "--file", opts.out, "--dbname", url], { encoding: "utf8", stdio: ["ignore", "inherit", "pipe"] });
      if (r.status !== 0) {
        console.error(`✗ pg_dump failed (exit ${r.status})`);
        // pg_dump names objects, not rows; a connection failure names the host,
        // and that line stays out of a terminal that may be screen-shared.
        if (r.stderr) console.error(r.stderr.split("\n").filter((l) => !/postgres(ql)?:\/\/|connection to server/.test(l)).join("\n"));
        process.exit(1);
      }
      chmodSync(opts.out, 0o600);
      dump = { file: basename(opts.out), sha256: String(await sha256File(opts.out)), bytes: statSync(opts.out).size };
    }
    await client.query("COMMIT");
    const doc = { version: 1, takenAt: new Date().toISOString(), serverVersion: facts.serverVersion,
      ledger: facts.ledger, tables: facts.tables, ...(dump ? { dump } : {}) };
    writeFileSync(/** @type {string} */ (countsPath), JSON.stringify(doc, null, 2) + "\n", { mode: 0o600 });
    const rows = Object.values(facts.tables).reduce((a, n) => a + n, 0);
    console.log(`✓ ${Object.keys(facts.tables).length} tables, ${rows} rows, ${Object.keys(facts.ledger).length} migrations in the ledger → ${countsPath}`);
    if (dump) console.log(`✓ ${dump.file}: ${dump.bytes} bytes, sha256 ${dump.sha256}`);
  } finally {
    await client.end();
  }
}

/** @param {{from?: string}} opts */
async function restore(opts) {
  const url = ownerUrl();
  if (!opts.from) usage("restore needs --from FILE.dump");
  if (!isLocalUrl(url)) {
    console.error(`✗ refusing to restore into ${describeUrl(url)}: restore writes, and this tool writes only to a database on this machine.\n` +
      `  The drill restores into a fresh local database (docs/pilot/BACKUP_RESTORE.md). A restore into production is not this command.`);
    process.exit(2);
  }
  if (!existsSync(opts.from)) { console.error(`✗ ${opts.from} does not exist`); process.exit(2); }

  const client = await connect(url);
  try {
    const { rows: [{ n }] } = await client.query(`
      SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
       WHERE ns.nspname = 'public' AND c.relkind IN ('r','p','v','m')
         AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e')`);
    if (n > 0) {
      console.error(`✗ refusing to restore into ${describeUrl(url)}: it already has ${n} table(s) or view(s) in public. Restore into a new, empty database.`);
      process.exit(2);
    }

    // The schema alone (no rows) is enough to know which roles the grants name.
    const list = spawnSync("pg_restore", ["--schema-only", "--file", "-", opts.from], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    if (list.status !== 0) { console.error(`✗ pg_restore could not read ${opts.from}\n${list.stderr}`); process.exit(1); }
    const { rows: have } = await client.query("SELECT rolname FROM pg_roles");
    const existing = new Set(have.map((r) => r.rolname));
    for (const role of rolesInAcl(list.stdout).filter((r) => !existing.has(r))) {
      // NOLOGIN: a name for the grants to attach to, never an account anyone signs in with.
      await client.query(`CREATE ROLE "${role.replace(/"/g, '""')}" NOLOGIN`);
      console.log(`  + role ${role} (NOLOGIN, so the dump's grants restore whole)`);
    }
    // A schema-only dump of public leaves extensions out; the schema needs pgcrypto.
    await client.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
  } finally {
    await client.end();
  }

  const toc = spawnSync("pg_restore", ["--list", opts.from], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (toc.status !== 0) { console.error(`✗ pg_restore could not list ${opts.from}\n${toc.stderr}`); process.exit(1); }
  const dir = mkdtempSync(join(tmpdir(), "scrbrd-restore-"));
  const listFile = join(dir, "toc.list");
  writeFileSync(listFile, withoutPublicSchema(toc.stdout), { mode: 0o600 });

  console.log(`Restoring ${basename(opts.from)} into ${describeUrl(url)}…`);
  const r = spawnSync("pg_restore", ["--no-owner", "--exit-on-error", "--single-transaction", "--no-password",
    "--use-list", listFile, "--dbname", url, opts.from], { encoding: "utf8", stdio: ["ignore", "inherit", "pipe"] });
  rmSync(dir, { recursive: true, force: true });
  if (r.status !== 0) { console.error(`✗ pg_restore failed (exit ${r.status}); nothing was restored (one transaction)\n${r.stderr}`); process.exit(1); }
  console.log("✓ restored");
}

/** @param {{counts?: string, dump?: string}} opts */
async function verify(opts) {
  const url = ownerUrl();
  if (!opts.counts) usage("verify needs --counts FILE.counts.json");
  const expected = parseCounts(readFileSync(opts.counts, "utf8"));
  const shipped = parseShipped(readFileSync(join(ROOT, "db", "SHIPPED.sha256"), "utf8"));

  const client = await connect(url);
  let facts;
  try {
    await beginReadOnly(client);
    facts = await snapshotFacts(client);
    await client.query("COMMIT");
  } finally {
    await client.end();
  }

  let fails = 0;
  /** @param {string} label @param {string[]} problems */
  const report = (label, problems) => {
    console.log(`${problems.length ? "✗" : "✓"} ${label}`);
    for (const p of problems.slice(0, 40)) console.log(`    ${p}`);
    if (problems.length > 40) console.log(`    … and ${problems.length - 40} more`);
    if (problems.length) fails++;
  };

  console.log(`Verifying ${describeUrl(url)} against ${basename(opts.counts)} (taken ${expected.takenAt})\n`);
  const ledgerNow = new Map(Object.entries(facts.ledger));
  report(`ledger matches db/SHIPPED.sha256 (${ledgerNow.size} in the ledger, ${shipped.size} shipped)`,
    compareLedgers(ledgerNow, shipped, "the restored ledger", "SHIPPED.sha256"));
  report("ledger matches the ledger at dump time",
    compareLedgers(ledgerNow, new Map(Object.entries(expected.ledger)), "the restored ledger", "the counts file"));
  const rows = Object.values(facts.tables).reduce((a, n) => a + n, 0);
  report(`row counts match the dump-time counts (${Object.keys(facts.tables).length} tables, ${rows} rows)`,
    compareCounts(expected.tables, facts.tables));
  if (opts.dump) {
    const sum = String(await sha256File(opts.dump));
    report("the dump file is the one the counts were taken with",
      !expected.dump ? ["the counts file records no dump (it was written by `counts`, not `dump`)"]
        : sum === expected.dump.sha256 ? [] : [`sha256 ${sum.slice(0, 12)}…, recorded ${expected.dump.sha256.slice(0, 12)}…`]);
  }
  if (majorOf(facts.serverVersion) !== majorOf(expected.serverVersion)) {
    console.log(`! the source was Postgres ${majorOf(expected.serverVersion)}, this copy is ${majorOf(facts.serverVersion)} (fine for a drill; a production restore should match)`);
  }

  console.log(`\n${fails ? "BACKUP VERIFY FAILED" : "BACKUP VERIFIED"}: ${fails} check(s) failed`);
  process.exit(fails ? 1 : 0);
}

async function main() {
  const { mode, opts } = parseArgs(process.argv.slice(2));
  if (mode === "dump") return takeCounts(opts, true);
  if (mode === "counts") return takeCounts(opts, false);
  if (mode === "restore") return restore(opts);
  if (mode === "verify") return verify(opts);
  usage(mode ? `unknown mode "${mode}"` : undefined);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    // Never echo an error object whole: a driver error can quote the connection.
    console.error(`✗ ${String(e?.message ?? e).replace(/postgres(ql)?:\/\/\S+/g, "postgres://***")}`);
    process.exit(1);
  });
}

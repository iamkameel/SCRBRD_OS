#!/usr/bin/env node
/**
 * A worktree's own database, so two worktrees can run the full verification
 * against the same Postgres cluster at the same time with no shared lock.
 *
 * Creates `scrbrd_<slug>` (owned by the same role that owns `scrbrd`) if it
 * does not already exist, then prints the `export` lines that point every
 * tool in this repository at it: SCRBRD_DB, a stable SCRBRD_PORT_OFFSET
 * derived from the slug, and the per-database lock file's path. Nothing here
 * runs a migration — `node tools/migrate.mjs --reset --seed --verify` still
 * does that, reading SCRBRD_DB the moment it is exported.
 *
 *   node tools/worktree-db.mjs                  slug from this worktree's path
 *   node tools/worktree-db.mjs pa                explicit slug
 *   eval "$(node tools/worktree-db.mjs pa)"      export straight into the shell
 *
 * The slug becomes part of a Postgres identifier and a filename, so it is
 * narrowed to lowercase letters, digits and underscores, 32 characters, and
 * cannot start with a digit (Postgres would otherwise require quoting it
 * forever). Given no argument, it is derived from the current worktree's
 * directory name — the part after the last path separator, lower-cased and
 * narrowed the same way — which is stable for as long as the worktree exists
 * and distinct from every sibling worktree's own directory name.
 */
import pg from "pg";
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { ownerUrl } from "./db-url.mjs";

const narrow = (s) => s.toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/^[^a-z_]+/, "").slice(0, 32);

const argSlug = process.argv[2];
const slug = narrow(argSlug || basename(process.cwd()));
if (!slug) {
  console.error("✗ could not derive a usable slug from " + (argSlug ? `"${argSlug}"` : `the worktree path (${process.cwd()})`));
  console.error("  pass one explicitly: node tools/worktree-db.mjs <slug>");
  process.exit(2);
}

const database = `scrbrd_${slug}`;

// A stable offset derived from the slug rather than handed out sequentially:
// two calls for the same slug (a re-run, or a second worktree resuming an
// earlier one) always land on the same ports, and nothing here has to track
// which offsets are already taken. Multiples of 100, from 100 to 5000 —
// clear of the unshifted defaults (offset 0) and wide enough that no walk's
// own spread of ports (a browser walk's WEB_PORT and API_PORT sit within
// about 60 of each other) crosses into a neighbour's range.
const offsetFor = (s) => 100 + (createHash("sha256").update(s).digest().readUInt32BE(0) % 50) * 100;
const offset = offsetFor(slug);

const lockFile = `/tmp/scrbrd-db-${database}.lock`;

// Connects as the schema owner — the role RUNNING.md has creating databases
// (CREATEDB, or, as on this shared machine, superuser) — to whichever
// database ownerUrl() currently resolves to (DATABASE_URL if set, otherwise
// SCRBRD_DB or its "scrbrd" default). CREATE DATABASE runs against the
// server, not "into" that connection's own database, so this works whether
// it is pointed at "scrbrd" or at an earlier worktree's own database.
const adminUrl = new URL(ownerUrl());
const client = new pg.Client({ connectionString: adminUrl.toString() });
await client.connect();
try {
  const { rows } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [database]);
  if (rows.length) {
    console.error(`# ${database} already exists`);
  } else {
    // Not parameterisable — CREATE DATABASE takes an identifier, not a
    // value — so it is quoted here instead. narrow() already limits the
    // slug to [a-z0-9_], which cannot contain a quote or close the
    // identifier early.
    await client.query(`CREATE DATABASE "${database}"`);
    console.error(`# created ${database}`);
  }
} finally {
  await client.end();
}

const dropUrl = new URL(adminUrl.toString());
dropUrl.pathname = "/postgres";

console.log(`export SCRBRD_DB=${database}`);
console.log(`export SCRBRD_PORT_OFFSET=${offset}`);
console.log(`# lock file: ${lockFile}`);
console.log(`#   flock ${lockFile} bash -c 'node tools/migrate.mjs --reset --seed --verify && node tools/run-all-tests.mjs && node tools/run-smoke-api.mjs && node tools/run-smoke-api.mjs --browser'`);
console.log(`# drop it when done:`);
console.log(`#   psql "${dropUrl}" -c 'DROP DATABASE "${database}"'`);

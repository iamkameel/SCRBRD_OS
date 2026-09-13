#!/usr/bin/env node
/**
 * Wait for Postgres to accept connections, then exit 0.
 *
 * `pnpm db:up` has always been `docker compose up -d db && node
 * tools/wait-for-db.mjs` — and this file did not exist, so the documented way
 * to start the database failed on every machine the moment Docker succeeded.
 * The container's own healthcheck is not enough on its own: `compose up -d`
 * returns before the healthcheck has passed, and the very next command a person
 * types is `pnpm db:reset`, which shells out to psql against a socket that is
 * not listening yet.
 *
 * Polls the same URL the migrations use, so what this proves is exactly what
 * the next step needs. Uses the pg driver already in the tree rather than
 * pg_isready, which is not installed everywhere psql is.
 */
import pg from "pg";

const URL = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const DEADLINE_MS = Number(process.env.DB_WAIT_MS || 60_000);
const started = Date.now();

const redacted = URL.replace(/:\/\/([^:]+):[^@]+@/, "://$1:***@");
process.stdout.write(`Waiting for Postgres at ${redacted} `);

for (;;) {
  const client = new pg.Client({ connectionString: URL, connectionTimeoutMillis: 2000 });
  try {
    await client.connect();
    await client.query("select 1");
    await client.end();
    console.log(`\n✓ database is accepting connections (${Math.round((Date.now() - started) / 100) / 10}s)`);
    process.exit(0);
  } catch (e) {
    await client.end().catch(() => {});
    if (Date.now() - started > DEADLINE_MS) {
      console.error(`\n✗ gave up after ${DEADLINE_MS / 1000}s: ${e.message}`);
      console.error("  Is the container running? `docker compose ps` — or, for a local Postgres,");
      console.error("  does the role and database in DATABASE_URL exist? See RUNNING.md.");
      process.exit(1);
    }
    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, 1000));
  }
}

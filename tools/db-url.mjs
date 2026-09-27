#!/usr/bin/env node
/**
 * One source for every connection string and HTTP port the tools use.
 *
 * Every agent's verification used to share ONE local database behind ONE
 * lock file, because the database address was hard-coded in about ninety
 * files and every walk hard-coded its own ports. Two worktrees running the
 * full verification at once collided on both. This module is the fix: a
 * worktree sets two environment variables — SCRBRD_DB and
 * SCRBRD_PORT_OFFSET — and every tool that imports from here points at its
 * own database and its own ports instead. tools/worktree-db.mjs creates that
 * database and prints the export lines that set them.
 *
 * Nothing here changes the default. With SCRBRD_DB and SCRBRD_PORT_OFFSET
 * both unset, ownerUrl(), appUrl() and port(n) return exactly what every
 * tool hard-coded before: postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd,
 * postgres://scrbrd_app:scrbrd_app@127.0.0.1:5432/scrbrd, and n unchanged.
 *
 *   SCRBRD_DB            the database name (default "scrbrd")
 *   SCRBRD_DB_HOST        the database host (default "127.0.0.1")
 *   SCRBRD_DB_PORT        the database port (default "5432")
 *   SCRBRD_PORT_OFFSET    added to every walk's hard-coded HTTP port (default 0)
 *
 * An explicit DATABASE_URL (the schema owner) or APP_DATABASE_URL (the
 * application role) still wins wherever a tool honours it today — this
 * module only supplies the default a tool falls back to. That is also why
 * tools/migrate.mjs's own DATABASE_URL handling and its "refuse --reset on a
 * non-local host" guard are untouched: they read ownerUrl() as their
 * default, same as before, and DATABASE_URL still overrides it exactly as
 * it always has.
 */

const HOST = process.env.SCRBRD_DB_HOST || "127.0.0.1";
const DB_PORT = process.env.SCRBRD_DB_PORT || "5432";
const DB = process.env.SCRBRD_DB || "scrbrd";

const urlFor = (/** @type {string} */ role) => `postgres://${role}:${role}@${HOST}:${DB_PORT}/${DB}`;

/** The schema owner: migrations, seeding, the live RLS verifier, benches. */
export const ownerUrl = () => process.env.DATABASE_URL || urlFor("scrbrd");

/** The unprivileged role every walk starts the API server as (db/06_app_role.sql). */
export const appUrl = () => process.env.APP_DATABASE_URL || urlFor("scrbrd_app");

/** The database name alone (SCRBRD_DB, default "scrbrd"). */
export const dbName = () => DB;

/**
 * The per-database lock file agents wrap verification in with `flock`. The
 * default database keeps the original, unqualified path exactly, so nothing
 * that already names /tmp/scrbrd-db.lock needs to change.
 */
export const lockFile = () => (DB === "scrbrd" ? "/tmp/scrbrd-db.lock" : `/tmp/scrbrd-db-${DB}.lock`);

// Chromium (and every browser built on it) refuses to navigate to a fixed
// list of ports associated with well-known plaintext protocols —
// net::ERR_UNSAFE_PORT — a fact no walk's literal port number ever had to
// know until an arbitrary SCRBRD_PORT_OFFSET could land one on it by chance.
// Found this way: WEB_PORT 5297 + offset 1400 = 6697 (IRC-over-TLS), and
// smoke-browser-toss.mjs's page.goto() refused outright. Rather than pick
// offsets that happen to dodge today's literal ports — which the next added
// walk could still land on — port() steps past an unsafe result so every
// offset is safe for every port any walk asks for, now or later.
const UNSAFE_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79,
  87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135,
  137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531,
  532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719,
  1720, 1723, 2049, 3659, 4045, 5060, 5061, 6000, 6566, 6665, 6666, 6667,
  6668, 6669, 6697, 10080,
]);

/**
 * A walk's hard-coded HTTP port, shifted by SCRBRD_PORT_OFFSET (default 0)
 * so the same walk run in two worktrees does not collide. With the offset
 * unset or 0, port(8829) is still 8829 — today's default, unchanged — and a
 * shifted result that lands on an unsafe port steps forward until it does not.
 */
export const port = (/** @type {number} */ base) => {
  let p = base + (Number(process.env.SCRBRD_PORT_OFFSET) || 0);
  while (UNSAFE_PORTS.has(p)) p += 1;
  return p;
};

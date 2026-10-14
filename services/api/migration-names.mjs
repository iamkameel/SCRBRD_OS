/**
 * Which files in db/ are migrations, and in what order they run.
 *
 * A migration is NN_name.sql with a two- or three-digit number: 00–97, then
 * 100 onwards. 98_seed_pilot.sql is fixture data (--seed) and 99_rls_verify.sql
 * is the live verifier (--verify); neither is schema, and applying either as a
 * migration is how a seed ends up running twice.
 *
 * Order is by number, never by spelling: sorted as text, "100_x.sql" would
 * come before "11_y.sql" and run ninety migrations early. Every reader of db/
 * (the migrator, the paste bundles, the schema guard, the tests that read the
 * schema) takes its list from here, so they cannot disagree.
 */
import { readdirSync } from "node:fs";

const NAME = /^(\d{2,3})_[^/]*\.sql$/;

/** The file's number, or NaN when it is not shaped like a migration. */
export const migrationNumber = (/** @type {string} */ file) => Number(NAME.exec(file)?.[1] ?? NaN);

/** The seed (98) and the verifier (99): in db/, numbered, and never migrations. */
export const isFixtureFile = (/** @type {string} */ file) => /^9[89]_/.test(file);

export const isMigrationFile = (/** @type {string} */ file) => NAME.test(file) && !isFixtureFile(file);

/** Run order: by number, then by name only so that a clash still sorts the same everywhere. */
export const byMigrationOrder = (/** @type {string} */ a, /** @type {string} */ b) =>
  migrationNumber(a) - migrationNumber(b) || (a < b ? -1 : a > b ? 1 : 0);

/** The migrations in a db/ directory, in the order they run. */
export const migrationFiles = (/** @type {string} */ dir) =>
  readdirSync(dir).filter(isMigrationFile).sort(byMigrationOrder);

/** The number as the paste kits spell it: "92", "100". */
export const migrationPrefix = (/** @type {string} */ file) => NAME.exec(file)?.[1] ?? "";

/**
 * Refuse to serve code the database has not caught up with (SCRBRD-066).
 *
 * On 2026-09-23 production's API and client were running merged PRs #30 and
 * #31 against a database still at db/23 — db/24–db/27 had never been applied.
 * Every screen that reached for what those files create would have failed
 * with 42P01 / 42883 until somebody noticed. DEPLOYING.md's rule is "schema
 * first, always"; the deploy workflow ships on every push to main whatever
 * state the database is in, so the rule was a sentence.
 *
 * This makes it a check. At boot the server compares the migrations it was
 * built against (expected-migrations.json, next to this file) with the ones
 * the database's ledger records, and refuses to start if any is missing. On
 * Cloud Run and Render a revision that does not start never takes traffic,
 * so a deploy that is ahead of its schema fails safe: the previous revision
 * keeps serving.
 *
 * WHY A LIST HERE rather than reading db/: the image (Dockerfile) carries
 * packages/ and services/api/ and nothing else, so db/ is not there to read.
 * The list is names only — db/SHIPPED.sha256 pins the bytes of what shipped,
 * and an unshipped file legitimately changes. schema-guard.test.mjs fails
 * the suite when the list and db/ disagree, so adding a migration without
 * adding it here is caught before it merges.
 *
 * A DATABASE AHEAD OF THE CODE IS FINE. Schema-first means the database
 * routinely has a file the running code does not know about yet; extras are
 * ignored. Only a missing one refuses.
 *
 * The application role cannot read schema_migration (RLS on, no policy, on
 * purpose), so the names come through schema_migrations_applied(), a
 * SECURITY DEFINER function db/29 adds and grants to scrbrd_app alone. That
 * file is itself in the expected list — production applies db/29 before the
 * first API that checks for it, which is the rule working as intended.
 *
 * There is no switch to turn this off. A database behind the code is fixed
 * by applying the migration (locally: `node tools/migrate.mjs`), or by
 * deploying the older code; a server that starts anyway is the incident.
 */
import { readFileSync } from "node:fs";

export const EXPECTED = JSON.parse(
  readFileSync(new URL("./expected-migrations.json", import.meta.url), "utf8"));

/** The migration that gives the application role a way to read the ledger. */
export const LEDGER_READER = "29_migration_ledger_read.sql";

/** Expected names the database does not have, in migration order. */
export const missingMigrations = (expected, applied) => {
  const have = new Set(applied);
  return expected.filter((name) => !have.has(name));
};

const applyStep = (name) =>
  `    node tools/bundle-sql.mjs --apply ${name.slice(0, 2)}   → scrbrd-supabase-apply-${name.slice(0, 2)}.sql  (${name})`;

const FIX_TAIL =
  `\nAfter the last one, paste scrbrd-supabase-verify.sql and expect ALL RLS LIVE\n` +
  `ASSERTIONS PASSED; then redeploy. The previous revision keeps serving meanwhile.\n` +
  `With a terminal instead (Cloud SQL, development): node tools/migrate.mjs, as the owner.\n`;

/**
 * The operator's message for a database missing `missing`, or null when
 * nothing is missing. `ledgerUnreadable` is the case where even db/29 is
 * absent, so the database cannot say what else it lacks.
 */
export function refusalMessage(missing, { ledgerUnreadable = false, expected = EXPECTED } = {}) {
  if (ledgerUnreadable) {
    return `\nRefusing to start: this database cannot say which migrations it has.\n` +
      `  schema_migrations_applied() does not exist, so at least ${LEDGER_READER}\n` +
      `  has not been applied — and very likely others before it.\n\n` +
      `This code was built against ${expected.length} migrations, up to ${expected[expected.length - 1]}.\n` +
      `Serving it would fail with 42P01/42883 on every screen that needs what is missing.\n\n` +
      `Fix (DEPLOYING.md, "When production is behind by more than one file"): find where\n` +
      `the database is, in its SQL Editor, as the owner —\n` +
      `    SELECT name FROM schema_migration ORDER BY name;\n` +
      `then apply scrbrd-supabase-apply-NN.sql for each missing number, in order\n` +
      `(DEPLOYING.md, "The procedure"), up to and including ${LEDGER_READER.slice(0, 2)}:\n` +
      `    node tools/bundle-sql.mjs --apply NN\n` + FIX_TAIL;
  }
  if (!missing.length) return null;
  return `\nRefusing to start: the database is missing ${missing.length} migration(s) this code was built against.\n` +
    missing.map((m) => `  missing:  ${m}`).join("\n") +
    `\n\nServing this code would fail with 42P01/42883 on every screen that needs what\n` +
    `those files create. Schema first, always.\n\n` +
    `Fix: apply scrbrd-supabase-apply-NN.sql for each, in this order (DEPLOYING.md,\n` +
    `"The procedure"):\n` +
    missing.map(applyStep).join("\n") + "\n" + FIX_TAIL;
}

/**
 * Ask the database. Returns the refusal message, or null when the schema has
 * everything this code expects. Any error other than "db/29 is not there" is
 * thrown: a ledger that cannot be read for an unknown reason is not evidence
 * that the schema is current.
 */
export async function schemaRefusal(pool, expected = EXPECTED) {
  let applied;
  try {
    ({ rows: applied } = await pool.query("SELECT schema_migrations_applied() AS name"));
  } catch (e) {
    if (e?.code === "42883") return refusalMessage([], { ledgerUnreadable: true, expected });
    throw e;
  }
  return refusalMessage(missingMigrations(expected, applied.map((r) => r.name)), { expected });
}

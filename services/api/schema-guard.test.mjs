// The API's record of which migrations it was built against (SCRBRD-066).
//
// The image does not carry db/, so services/api/expected-migrations.json is
// the server's only knowledge of the schema it needs. A list kept by hand goes
// stale the first time somebody adds a db/NN and forgets it — and a stale list
// is worse than none: the server would start against a database missing the
// very file the new code calls. So this holds the list to db/, exactly.
//
// The refusal itself is asserted live, against a real server and a real
// ledger, by tools/smoke-schema-guard.mjs.
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { EXPECTED, LEDGER_READER, missingMigrations, refusalMessage, schemaRefusal } from "./schema-guard.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
let passes = 0, fails = 0;
/** @param {string} label @param {unknown} cond @param {string} [detail] */
const ok = (label, cond, detail = "") => {
  console.log(`${cond ? "✓" : "✗"} ${label}${cond || !detail ? "" : `\n    ${detail}`}`);
  if (cond) passes++; else fails++;
};

// ── The list agrees with db/ ─────────────────────────────────────
// The same filter tools/migrate.mjs applies: NN_*.sql, never 98_ (seed) or
// 99_ (verifier), in the order the migrator runs them.
const onDisk = readdirSync(join(ROOT, "db")).filter((f) => /^\d\d_.*\.sql$/.test(f) && !/^9[89]_/.test(f)).sort();
const listed = new Set(EXPECTED);
const unlisted = onDisk.filter((f) => !listed.has(f));
const phantom = EXPECTED.filter((f) => !onDisk.includes(f));

ok("expected-migrations.json is an array of names", Array.isArray(EXPECTED) && EXPECTED.every((n) => typeof n === "string"));
ok("every db/NN migration is in services/api/expected-migrations.json", unlisted.length === 0,
   `add ${unlisted.map((f) => JSON.stringify(f)).join(", ")} — the API must refuse a database without it`);
ok("expected-migrations.json names no file that is not in db/", phantom.length === 0,
   `${phantom.join(", ")} — renamed or removed? The server would refuse every database`);
ok("expected-migrations.json is in migration order, without duplicates",
   JSON.stringify(EXPECTED) === JSON.stringify([...new Set(EXPECTED)].sort()));
ok("neither the seed nor the verifier is expected", !EXPECTED.some((n) => /^9[89]_/.test(n)));
ok(`the ledger reader (${LEDGER_READER}) is itself expected`, EXPECTED.includes(LEDGER_READER) && onDisk.includes(LEDGER_READER));

// ── What is missing, and what is not ─────────────────────────────
const exp = ["00_a.sql", "01_b.sql", "02_c.sql", "03_d.sql"];
ok("a complete ledger is missing nothing", missingMigrations(exp, exp).length === 0);
ok("a ledger AHEAD of the code is missing nothing (schema first)",
   missingMigrations(exp, [...exp, "04_future.sql"]).length === 0);
ok("a gap is named, in migration order",
   JSON.stringify(missingMigrations(exp, ["03_d.sql", "00_a.sql"])) === JSON.stringify(["01_b.sql", "02_c.sql"]));
ok("a complete ledger produces no refusal", refusalMessage([], { expected: exp }) === null);

// ── The message an operator acts on ──────────────────────────────
// "?? ''" below: refusalMessage() answers null only for nothing missing.
const msg = refusalMessage(["24_amend_request.sql", "25_disciplinary_record.sql"]) ?? "";
ok("the refusal says it refuses", /Refusing to start/.test(msg ?? ""));
ok("the refusal names every missing file",
   msg.includes("missing:  24_amend_request.sql") && msg.includes("missing:  25_disciplinary_record.sql"));
ok("the refusal names each paste, in order",
   msg.indexOf("scrbrd-supabase-apply-24.sql") > -1 && msg.indexOf("scrbrd-supabase-apply-24.sql") < msg.indexOf("scrbrd-supabase-apply-25.sql"));
ok("the refusal points at DEPLOYING.md's procedure and says to redeploy",
   msg.includes('DEPLOYING.md') && msg.includes('"The procedure"') && /redeploy/.test(msg));

const blind = refusalMessage([], { ledgerUnreadable: true }) ?? "";
ok("a database without db/29 is refused, not waved through", /Refusing to start/.test(blind ?? ""));
ok("…and told how to find where it is", blind.includes("SELECT name FROM schema_migration ORDER BY name") && blind.includes(LEDGER_READER));

// ── schemaRefusal() over a fake pool ─────────────────────────────
const pool = (/** @type {string[] | Error} */ rowsOrError) => ({
  query: async () => { if (rowsOrError instanceof Error) throw rowsOrError; return { rows: rowsOrError.map((name) => ({ name })) }; },
});
const err = (/** @type {string} */ code) => Object.assign(new Error(code), { code });
ok("complete → starts", (await schemaRefusal(pool(exp), exp)) === null);
ok("ahead → starts", (await schemaRefusal(pool([...exp, "04_future.sql"]), exp)) === null);
ok("behind → refuses, naming the gap", /missing:  02_c\.sql/.test((await schemaRefusal(pool(["00_a.sql", "01_b.sql", "03_d.sql"]), exp)) ?? ""));
ok("an empty ledger → refuses everything", ((await schemaRefusal(pool([]), exp)) ?? "").split("missing:").length - 1 === exp.length);
ok("no ledger function (42883) → refuses", /cannot say which migrations/.test((await schemaRefusal(pool(err("42883")), exp)) ?? ""));
/** @type {any} */             // what schemaRefusal threw
let thrown = null;
try { await schemaRefusal(pool(err("08006")), exp); } catch (e) { thrown = e; }
ok("any other error is thrown, never read as 'current'", thrown?.code === "08006");

console.log(`\nSCHEMA GUARD: ${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);

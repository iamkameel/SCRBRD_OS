/**
 * The century, twice: sa-id.mjs's resolveCentury() and db/172's sa_id_born()
 * must give one answer for every ID number on every day.
 *
 * A YYMMDD number cannot say 19xx from 20xx by itself. The JavaScript
 * decides (20YY first, then 19YY; never a year after this one, never more
 * than 120 years ago, never a date that does not exist), and since db/172
 * the database decides too, in its trigger on player, where no route can
 * step round it. Two deciders drift. So db/99 §147 (pin) holds a list of
 * numbers, days and answers and asserts sa_id_born() against it in
 * Postgres; this test reads THE SAME LIST out of db/99 and asserts
 * bornFromSaId() against it here. Change either rule and one of the two
 * goes red.
 *
 * It also holds the JavaScript's names for the database's refusals to the
 * names db/172 raises, so a screen never waits for a word that never comes.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { bornFromSaId } from "@scrbrd/policy/sa-id";
import { BORN_REFUSED_BY_DB, BIRTH_DATE_MESSAGE } from "@scrbrd/policy/date-of-birth";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
let pass = 0, fail = 0;
/** @param {string} n @param {unknown} c @param {string} [d] */
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${d}` : ""); } };

const db99 = readFileSync(join(ROOT, "db", "99_rls_verify.sql"), "utf8");
const block = /-- v172 pin: begin\n([\s\S]*?)-- v172 pin: end/.exec(db99)?.[1] ?? "";
const rows = [...block.matchAll(/\('(\d{13})', DATE '(\d{4}-\d{2}-\d{2})', (?:DATE '(\d{4}-\d{2}-\d{2})'|NULL)\)/g)]
  .map((m) => ({ id: m[1], on: m[2], want: m[3] ?? null }));
const lines = block.split("\n").filter((l) => l.trim().startsWith("("));

ok("db/99 §147 (pin) holds the list", rows.length >= 15, `found ${rows.length}`);
ok("...and every line of it was read (none in a shape this test skips)", rows.length === lines.length,
   `${rows.length} read of ${lines.length}`);
ok("...with both centuries, a no-date and a year boundary in it",
   rows.some((r) => r.want?.startsWith("19")) && rows.some((r) => r.want?.startsWith("20"))
   && rows.some((r) => r.want === null) && rows.some((r) => r.on.endsWith("-01-01")));

for (const r of rows) {
  // Noon UTC: the JavaScript reads the UTC year, as the SQL's (now() AT TIME ZONE 'UTC').
  const got = bornFromSaId(r.id, new Date(`${r.on}T12:00:00Z`));
  ok(`${r.id} on ${r.on} is ${r.want ?? "no date"}, in JavaScript as in SQL`, got === r.want, `JS says ${got}`);
}

// db/172's trigger, and db/173's that replaces it, raise the same names.
const db172 = readFileSync(join(ROOT, "db", "172_dob_audited_correction.sql"), "utf8")
  + readFileSync(join(ROOT, "db", "173_dob_first_dates.sql"), "utf8");
for (const name of BORN_REFUSED_BY_DB) {
  ok(`db/172 or db/173 raises ${name} by that name`, db172.includes(`RAISE EXCEPTION '${name}'`));
  ok(`...and the office has words for it`, typeof BIRTH_DATE_MESSAGE[name] === "string" && BIRTH_DATE_MESSAGE[name].length > 10);
}
ok("every name db/172 and db/173 raise is one the routes read",
   [...db172.matchAll(/RAISE EXCEPTION '([a-z_]+)'/g)].every((m) => BORN_REFUSED_BY_DB.includes(m[1])));

console.log(`\n${"─".repeat(52)}\nSA ID SQL PIN: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

// The tests read the day the product reads.
//
// db/128 moved every "live today" check in the schema to sa_today(), the day
// in Johannesburg. The RLS verifier's own oracles and six API walks still
// computed today as the database's UTC day (current_date, or
// new Date().toISOString().slice(0, 10)), which is a day behind between 00:00
// and 02:00 SAST. CI went red in that window and green on the re-run (#233,
// 4 Nov 2026, 01:21 SAST: the verifier at §43 "db/65 (notice)", where
// _link_live_65() asked current_date of a link availability_ask_again()
// judged on sa_today(); and API shards 1, 3 and 4).
//
// This holds db/99 and those walks to the SA day. A current_date in db/99 is
// allowed only where it means the UTC day on purpose: db/128's break and
// mend of a body, the md5 of a body read back on db/92's clock, the checks
// that a body no longer spells it, and §105's pinned UTC day.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let passes = 0, fails = 0;
const ok = (label, cond, detail = "") => {
  console.log(`${cond ? "✓" : "✗"} ${label}${cond || !detail ? "" : `\n    ${detail}`}`);
  if (cond) passes++; else fails++;
};

// The deliberate ones, each by what it says rather than by line number.
const DELIBERATE = [
  /replace\(prosrc, 'sa_today\(\)', 'current_date'\)/,           // grant_md5: db/92's body, read back
  /replace\(v_def, 'sa_today\(\)', 'current_date'\)/,            // _v128_break(true): the guard's red
  /regexp_replace\(v_def, '\\mcurrent_date\\M', 'sa_today\(\)'/,  // _v128_break(false): mended
  /position\('current_date' IN got\) = 0/,                         // §102 (k): a body no longer spells it
  /still asks current_date, or not sa_today\(\)/,                  // §102 (k): its message
  /~\* '\\mcurrent_date\\M\|localtimestamp/,                       // §105 (scan): the catalog's spellings
  /proargdefaults, 0\), ''\) ~\* 'current_date'/,                  // §105 (scan): argument defaults
  /_v128_clock\([AB]\) = n( \+ 1)? AND current_date = n/,          // §105: the pinned instants' UTC day
];

const code = (/** @type {string} */ l) => !/^\s*--/.test(l);
const lines = readFileSync(join(ROOT, "db", "99_rls_verify.sql"), "utf8").split("\n");
const stray = lines
  .map((l, i) => ({ l, n: i + 1 }))
  .filter(({ l }) => code(l) && /\bcurrent_date\b/i.test(l) && !DELIBERATE.some((re) => re.test(l)));
ok("db/99 reads today as sa_today(), the day the product reads since db/128", stray.length === 0,
   stray.slice(0, 10).map(({ l, n }) => `db/99:${n}: ${l.trim().slice(0, 140)}`).join("\n    "));
const kept = lines.filter((l) => code(l) && DELIBERATE.some((re) => re.test(l))).length;
ok("...and each deliberate UTC day is still there (10 lines)", kept === 10, `found ${kept}`);

// The walks that went red in the window, and the day each reads.
const WALKS = ["assess", "guardian", "link18", "moves", "notes", "rating"];
for (const w of WALKS) {
  const src = readFileSync(join(ROOT, "tools", `smoke-${w}.mjs`), "utf8")
    .split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  const sql = (src.match(/\bcurrent_date\b/gi) ?? []).length;
  // today, or tomorrow, as the UTC day (a fixed later date is the same on both sides)
  const utc = (src.match(/new Date\((Date\.now\(\) \+ 86400000)?\)\.toISOString\(\)\.slice\(0, ?10\)/g) ?? []).length;
  ok(`smoke-${w}.mjs reads today as the SA day`, sql === 0 && utc === 0,
     `${sql} current_date, ${utc} UTC day(s) as today`);
}

console.log(`\nSA DAY: ${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);

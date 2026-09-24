/**
 * The typecheck's strict list only grows.
 *
 * tsconfig.json's `include` is the set of files `pnpm typecheck` holds to zero
 * errors. Deleting a line from it is the easy way to make a red check green,
 * and it looks like housekeeping in a diff. So the floor is written down here
 * too: dropping a package from the list means editing this file as well, in
 * the same diff, where a reviewer sees it.
 *
 * It also refuses an entry that matches nothing. A typo in `include` is not an
 * error to tsc — it checks zero files and reports zero errors, which reads
 * exactly like success.
 */
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { strictList, prefixOf, tsconfig, excludedList, excludes } from "./typecheck.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Add to this when a package joins the list. Never remove from it.
const FLOOR = [
  "packages/policy/src/**/*.mjs",
  "packages/policy/test/**/*.mjs",
  "packages/sync/src/**/*.mjs",
  "packages/scoring/src/**/*.mjs",
  "packages/scoring/test/**/*.mjs",
  "services/api/**/*.mjs",
];

// tsconfig.json's `exclude` punches holes in the list, and a hole is the other
// easy way to make a red check green. So the holes are written down here too,
// as a ceiling: an exclusion not named here fails. Remove a line when its file
// joins the list. Never add one without a reason in tsconfig.json beside it.
const HOLES_CEILING = [
  "**/node_modules",
  // Being rewritten in parallel when services/api joined. The next addition.
  "services/api/write/events-api.mjs",
];

let pass = 0, fail = 0;
/** @param {string} n @param {unknown} c @param {string} [d] */
const ok = (n, c, d = "") => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${d}` : ""); } };

const list = strictList();
const missing = FLOOR.filter((g) => !list.includes(g));
ok("every package on the floor is still on the strict list", missing.length === 0, missing.join(", "));

const dead = list.filter((g) => !existsSync(join(ROOT, prefixOf(g))));
ok("every strict-list entry names a directory that exists", dead.length === 0, dead.join(", "));

ok("prefixOf stops at the first glob character",
   prefixOf("packages/policy/src/**/*.mjs") === "packages/policy/src/" && prefixOf("a/b.mjs") === "a/b.mjs");

const holes = excludedList();
const unknown = holes.filter((g) => !HOLES_CEILING.includes(g));
ok("every exclusion from the strict list is one this file knows about", unknown.length === 0, unknown.join(", "));

const staleHoles = holes.filter((g) => !g.startsWith("**/") && !existsSync(join(ROOT, g)));
ok("every excluded path exists (a hole for a deleted file is a hole for its replacement)",
   staleHoles.length === 0, staleHoles.join(", "));

ok("excludes() matches a file, a directory's contents, and **/ at any depth",
   excludes("services/api/write/events-api.mjs", "services/api/write/events-api.mjs")
   && !excludes("services/api/write/events-api.mjs.bak", "services/api/write/events-api.mjs")
   && excludes("services/api/node_modules/pg/lib/index.js", "**/node_modules")
   && excludes("node_modules/pg/lib/index.js", "**/node_modules")
   && !excludes("services/api/server.mjs", "**/node_modules"));

const opts = tsconfig().compilerOptions;
ok("the list is checked strictly", opts.strict === true && opts.checkJs === true && opts.noEmit === true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

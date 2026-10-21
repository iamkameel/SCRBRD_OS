/**
 * The coaching point's words, kept in two places and held together here
 * (GA-I27 §6, GA-I26a §2.2; db/104).
 *
 * A coaching point refuses the cockpit's never-words twice: the screen before
 * it sends (NEVER_ON_THE_COCKPIT, apps/web/src/lib/cockpitNever.js) and the
 * database before it stores (coaching_point_never(), db/104). Two copies of a
 * word list drift, and the drift is silent: a word added to one refuses on
 * the screen and stores through the API, or the other way round. So the SQL
 * copy is read out of the migration and compared to the JavaScript one, text
 * for text, with Postgres's word boundary (\y) for JavaScript's (\b).
 *
 * When the list changes, the SQL changes in a NEW migration (db/104 is frozen
 * once shipped) that replaces coaching_point_never(); this test then reads that
 * file, which is the last one in db/ to define the function.
 *
 *   node apps/web/test/coachingPoint.test.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { NEVER_ON_THE_COCKPIT } from "../src/lib/cockpitNever.js";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${JSON.stringify(d)}`); } };

const DB = join(dirname(fileURLToPath(import.meta.url)), "../../../db");
const files = readdirSync(DB).filter((f) => /^\d+_.*\.sql$/.test(f))
  .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
  .filter((f) => readFileSync(join(DB, f), "utf8").includes("CREATE OR REPLACE FUNCTION coaching_point_never("));
ok("a migration defines coaching_point_never()", files.length > 0);
const file = files.at(-1) ?? "";
const sql = file ? readFileSync(join(DB, file), "utf8") : "";
const body = sql.slice(sql.lastIndexOf("CREATE OR REPLACE FUNCTION coaching_point_never("));
const pattern = body.match(/~\*\s*'((?:[^']|'')*)'/)?.[1]?.replaceAll("''", "'");
ok(`${file} carries the pattern as one string`, typeof pattern === "string" && pattern.length > 20);

const asJs = (pattern ?? "").replaceAll("\\y", "\\b");
ok("the SQL copy is NEVER_ON_THE_COCKPIT, word for word", asJs === NEVER_ON_THE_COCKPIT.source,
   { sql: asJs, js: NEVER_ON_THE_COCKPIT.source });
ok("...and both are case-insensitive", NEVER_ON_THE_COCKPIT.flags.includes("i") && /~\*/.test(body));
ok("the SQL uses no \\b (in Postgres that is a backspace, not a boundary)", !(pattern ?? "").includes("\\b"));

// The sentences the proof uses, read the same way by both copies.
const sqlAsRegex = new RegExp(asJs, "i");
for (const [s, refused] of [
  ["front foot is late to the pitch", false],
  ["a hamstring niggle after the second spell", true],
  ["bowled at 70 % of his pace", true],
  ["under pressure he plays across the line", true],
  ["the ratio of dots to runs", true],
  ["his flagging energy late on", false],
]) {
  ok(`"${s}" is ${refused ? "refused" : "accepted"} by both`,
     NEVER_ON_THE_COCKPIT.test(s) === refused && sqlAsRegex.test(s) === refused);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

#!/usr/bin/env node
/**
 * What may leave as a file, and what never does (src/exports.mjs).
 *
 * The rule is two lists held apart: a short allowlist the office needs as a
 * file, and a refused list derived from the watched columns, the capability
 * levels and the named reads. These hold the policy's own half with no API
 * and no database; services/api/read/read.test.mjs holds the same two lists
 * apart with the API's real inputs, and tools/smoke-csv.mjs walks the route.
 *
 *   node packages/policy/test/exports.test.mjs
 */
import {
  EXPORTABLE, NAMED_NOT_EXPORTED, EXPORT_LEVEL_CEILING, notExported, exportAllowed, exportDrops, readLevelOf, tablesIn,
} from "../src/exports.mjs";
import { TABLES, maskedColumns } from "../src/tables.mjs";

let pass = 0, fail = 0;
const ok = (/** @type {string} */ n, /** @type {unknown} */ c, /** @type {unknown} */ d = "") => {
  if (c) pass++; else { fail++; console.log("  ✗", n, d); }
};
const group = (/** @type {string} */ t) => console.log("\n" + t);

group("The two lists are apart");
{
  const allowed = Object.keys(EXPORTABLE);
  ok("the allowlist is the roster and the fixtures, and nothing else",
     allowed.sort().join() === "matches,players", allowed);
  ok("nothing named is on the allowlist", NAMED_NOT_EXPORTED.every((r) => !allowed.includes(r)));
  ok("the health, conduct and family reads are named or derived, never allowed",
     ["injuries", "disciplinary_records", "emergency_contacts", "child_links", "bowling_breaches", "availability"]
       .every((r) => !allowed.includes(r)));
}

group("The roster file drops every masked column");
{
  const masked = [...new Set(Object.values(maskedColumns(TABLES.player)).flat())];
  ok("every column the player table masks is dropped", masked.every((c) => exportDrops("players").includes(c)),
     masked.filter((c) => !exportDrops("players").includes(c)));
  ok("...the address, the ID number, the birthday and the fitness among them",
     ["address", "id_number", "born", "fitness", "guardian"].every((c) => exportDrops("players").includes(c)));
  ok("a read off the list drops nothing, because it does not leave at all", exportDrops("injuries").length === 0);
}

group("The derivation");
{
  // Watched columns: refused unless the allowlist drops every one of them.
  const refused = notExported({
    restricted: { players: ["address", "id_number"], injuries: ["injury_type"], career: [], matches: ["secret"] },
    tablesRead: {},
  });
  ok("a read with a watched column is refused", refused.has("injuries"));
  ok("...the roster is not, because its file drops them", !refused.has("players"));
  ok("...an allowlisted read that gains a watched column it does not drop is refused", refused.has("matches"));
  ok("a read with no watched column is not refused by that rule alone", !refused.has("honours"));
  // Levels: a table governed by a level-2 capability.
  ok("the injury table's level is at the ceiling or above", readLevelOf("injury") >= EXPORT_LEVEL_CEILING);
  ok("the fixture table's is below it", readLevelOf("match") < EXPORT_LEVEL_CEILING);
  ok("a name that is no governed table has no level", readLevelOf("no_such_table") === -1);
  const byTable = notExported({ restricted: {}, tablesRead: { a: ["match"], b: ["match", "injury"] } });
  ok("a read joining a level-2 table is refused", byTable.has("b") && !byTable.has("a"));
  ok("the named reads are always refused", NAMED_NOT_EXPORTED.every((r) => byTable.has(r)));
}

group("Reading the tables out of a query");
{
  ok("FROM and JOIN, a masking view counted as its table",
     tablesIn("select * from player_masked pm join school s on s.id = pm.school_id").join() === "player,school");
  ok("a function in FROM is not a table", tablesIn("select * from passport($1::uuid)").length === 0);
  ok("an empty text reads nothing", tablesIn("").length === 0);
}

group("The door");
{
  const refused = notExported({ restricted: {}, tablesRead: {} });
  ok("an allowlisted read leaves", exportAllowed("players", refused) && exportAllowed("matches", refused));
  ok("the league table and the training calendar do not", !exportAllowed("league", refused) && !exportAllowed("training", refused));
  ok("a named read does not", !exportAllowed("career", refused));
  ok("a read on neither list does not either", !exportAllowed("honours", refused));
  ok("a prototype name is not a read", !exportAllowed("constructor", refused) && !exportAllowed("__proto__", refused));
}

console.log("\n" + "─".repeat(52));
console.log(`EXPORTS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

#!/usr/bin/env node
/**
 * SCRBRD-030, first half. The two lists that describe "sensitive" have to
 * agree with each other, and until now nothing checked that they did.
 *
 * There are two, in different languages:
 *
 *   SENSITIVE        — capabilities (packages/policy/src/capabilities.mjs).
 *                      What a person must hold to see a restricted thing.
 *   RESTRICTED_FIELDS — column names, per read resource (read-api.mjs).
 *                      What gets written into access_log when it comes back.
 *
 * Neither derives from the other. A capability added to SENSITIVE with no
 * watched column behind it is a promise nothing keeps: the pitch deck says
 * these are "logged on every read", and an unwatched disclosure is logged on
 * no read at all. A watched column whose capability is not sensitive is the
 * opposite mistake and cheaper — an over-logged read is noise, not a leak.
 *
 * This suite is the join. It also replaces an assertion in rls.test.mjs that
 * read "SENSITIVE capabilities are all used as mask gates or read gates" and
 * checked only that the names were spelled correctly — true of every string in
 * the file, and so a label rather than a test.
 *
 * What it found on the first run, which is why it exists: `discipline.read`
 * and `discipline.write` were held by six roles and gated NOTHING. No table
 * policy referenced them, no masked column, no read resource. They were
 * declarations of intent, and the intent was a good one, but until something
 * implemented them a school administrator who "can read discipline" could
 * read nothing and a reader who could was not logged. SCRBRD-053 built the
 * record (db/25_disciplinary_record.sql), and the pair came off
 * NOT_YET_IMPLEMENTED below because the `handGated` grep started finding them
 * — the "every recorded exception is still unimplemented" assertion goes red
 * otherwise, which is the list retiring itself rather than somebody
 * remembering to. `invoice.read`/`invoice.manage` are still there.
 *
 * Falsified by removing the `injuries` entry from RESTRICTED_FIELDS, which
 * leaves medical.nature.read and medical.details.read masking columns nobody
 * logs; and by adding a capability to SENSITIVE that nothing references. The
 * first attempt at the coverage check passed maskedColumns() a table NAME
 * where it wants a table DEFINITION, so it looped over an empty object and
 * could not fail — which the falsification caught and reading it had not.
 *
 *   node packages/policy/test/sensitivity.test.mjs
 */
import { SENSITIVE, ALL_CAPABILITIES, isCapability, LEVEL } from "../src/capabilities.mjs";
import { referencedCapabilities, maskedColumns, MASKED_TABLES, TABLES } from "../src/tables.mjs";
import { RESTRICTED_FIELDS } from "../../../services/api/read/read-api.mjs";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

let passes = 0, fails = 0;
const ok = (/** @type {string} */ label, /** @type {unknown} */ cond, detail = "") => {
  console.log(`${cond ? "✓" : "✗"} ${label}${cond || !detail ? "" : `\n    ${detail}`}`);
  if (cond) passes++; else fails++;
};
const group = (/** @type {string} */ t) => console.log("\n" + t);

/**
 * SCRBRD-030. `referencedCapabilities()` sees only what `tables.mjs` models —
 * a table's own `read`/`write`/masked columns, generated into RLS policies.
 * Some capabilities are deliberately NOT modelled there and are instead
 * checked by hand inside a SECURITY DEFINER function — `officiating.
 * registry.manage`'s own comment names the pattern ("See TABLES has no entry
 * for `official`... written by hand in db/08 for exactly this reason"), and
 * `guardian.link.manage`, `scouting.read/write` and `platform.support.
 * impersonate` all turned out to be the same case: real `app_can()`/
 * `app_holds()` guards in db/08, db/19 and db/22, invisible to the
 * table-generation model because they were never meant to be generated from
 * it. Treating "not in tables.mjs" as "not implemented" would have filed four
 * real gates as promises nobody kept. This greps the actual SQL for the
 * capability inside one of those two calls — a real, checkable signal, not a
 * rubber stamp — and folds it into the same `referenced` set.
 */
const DB_DIR = join(import.meta.dirname, "../../../db");
const dbSource = readdirSync(DB_DIR).filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(join(DB_DIR, f), "utf8")).join("\n");
const handGated = new Set(
  ALL_CAPABILITIES.filter((c) => new RegExp(`app_(can|holds)\\(\\s*'${c.replace(/\./g, "\\.")}'`).test(dbSource)));

const referenced = new Set([...referencedCapabilities(), ...handGated]);

/**
 * Sensitive capabilities that knowingly gate nothing yet.
 *
 * An entry here is a promise not yet kept, not a decision that it never will
 * be — so each carries what is missing, and the suite fails if one starts
 * being referenced, because then the entry is the stale thing.
 */
const NOT_YET_IMPLEMENTED = {
  // SCRBRD-030 widened SENSITIVE to level >= 2 and found this pair the same
  // way it found discipline.read/write the first time: a capability in the
  // catalogue and the role bundles, with no invoice table, policy, function
  // or read resource anywhere in the schema to be a real gate for.
  "invoice.read": "No invoice table exists in the schema. Four roles hold this " +
    "(schooladmin, directorofsport, sportsadmin, finance) and it gates " +
    "nothing: no table, no policy, no function, no read resource.",
  "invoice.manage": "The same from the writing end, held by finance alone — no " +
    "table for it to raise or reconcile a row in, so the write side is " +
    "exactly as unimplemented as the read side.",
};

// ── The two lists agree ──────────────────────────────────
group("Every sensitive capability gates something, or says why not");
{
  const unreferenced = SENSITIVE.filter((c) => !referenced.has(c));
  const unexplained = unreferenced.filter((c) => !(c in NOT_YET_IMPLEMENTED));
  ok("no sensitive capability gates nothing without saying so",
     unexplained.length === 0, unexplained.join(", "));
  // The exception list must not outlive its cause.
  const stale = Object.keys(NOT_YET_IMPLEMENTED).filter((c) => referenced.has(c));
  ok("...and every recorded exception is still unimplemented", stale.length === 0,
     `now referenced — delete from NOT_YET_IMPLEMENTED: ${stale.join(", ")}`);
  ok("...and each exception says what is missing",
     Object.values(NOT_YET_IMPLEMENTED).every((r) => typeof r === "string" && r.length > 60));
  ok("...and names a capability that exists",
     Object.keys(NOT_YET_IMPLEMENTED).every(isCapability));
  // The floor: if SENSITIVE were empty the three above would pass on nothing.
  ok(`SENSITIVE is non-trivial (${SENSITIVE.length} capabilities)`, SENSITIVE.length >= 8);
}

group("Every sensitive capability that IS implemented is watched on the way out");
{
  // maskedColumns() takes a table DEFINITION and returns {capability: [column]}.
  // The first version of this block passed it a table NAME and looped over an
  // empty object every time, so removing a whole resource from the logger left
  // it green — an assertion structurally incapable of failing, found by
  // falsifying it rather than by reading it.
  /** @type {Record<string, string[]>} */
  const gated = {};                       // capability → [table.column]
  for (const t of MASKED_TABLES)
    for (const [cap, cols] of Object.entries(maskedColumns(TABLES[t]) ?? {}))
      for (const col of cols) (gated[cap] ??= []).push(`${t}.${col}`);

  ok(`the mask map is populated (${Object.keys(gated).length} capabilities mask columns)`,
     Object.keys(gated).length >= 4, Object.keys(gated).join(" "));

  const live = SENSITIVE.filter((c) => referenced.has(c));
  ok(`${live.length} of ${SENSITIVE.length} sensitive capabilities are implemented`,
     live.length === SENSITIVE.length - Object.keys(NOT_YET_IMPLEMENTED).length);

  // The join is the bare column name: the mask map speaks table.column and the
  // logger speaks resource: [column].
  const watched = new Set(Object.values(RESTRICTED_FIELDS).flat().map((f) => f.split(".")[0]));
  ok(`the logger watches ${watched.size} distinct columns`, watched.size >= 10);

  const masking = live.filter((c) => gated[c]?.length);
  ok("most implemented sensitive capabilities mask a column",
     masking.length >= 5, `${masking.length}: ${masking.join(" ")}`);

  const unwatched = masking
    .filter((c) => !gated[c].some((tc) => watched.has(tc.split(".")[1])))
    .map((c) => `${c} → ${gated[c].join(",")}`);
  ok("and every column they mask is watched by the logger",
     unwatched.length === 0, unwatched.join(" · "));

  // A sensitive capability that masks nothing gates whole ROWS instead, which
  // a policy enforces and no column name can describe. Named rather than
  // skipped, so the count is visible if it grows.
  const rowGated = live.filter((c) => !gated[c]?.length);
  ok(`${rowGated.length} gate rows rather than columns, which is a policy's job`,
     rowGated.every((c) => referenced.has(c)), rowGated.join(" "));
}

group("SCRBRD-030: a watched column is never reached by an under-classified capability");
{
  // Recomputed rather than hoisted out of the group above — every group in
  // this file is self-contained, and the cost of rebuilding a 7-entry map is
  // nothing next to a second copy of it silently drifting from the first.
  /** @type {Record<string, string[]>} */
  const gated = {};
  for (const t of MASKED_TABLES)
    for (const [cap, cols] of Object.entries(maskedColumns(TABLES[t]) ?? {}))
      for (const col of cols) (gated[cap] ??= []).push(`${t}.${col}`);
  const watched = new Set(Object.values(RESTRICTED_FIELDS).flat().map((f) => f.split(".")[0]));

  ok("every capability carries a level", ALL_CAPABILITIES.every((c) => c in LEVEL));
  ok("...on the real 0–4 scale", Object.values(LEVEL).every((n) => Number.isInteger(n) && n >= 0 && n <= 4));
  // The class-level assertion the ordered scale exists for: a capability that
  // masks a column the logger already treats as sensitive cannot itself be
  // classified below Restricted Personal — that would be a capability
  // guarding real personal data while the scale calls it merely operational,
  // which is exactly the drift SENSITIVE being hand-listed used to allow.
  const underClassified = Object.entries(gated)
    .filter(([cap, cols]) => cols.some((tc) => watched.has(tc.split(".")[1])) && LEVEL[cap] < 2)
    .map(([cap]) => `${cap} (level ${LEVEL[cap]})`);
  ok("no capability masking a logged column is classified below level 2",
     underClassified.length === 0, underClassified.join(", "));
}

group("And the watched columns are watched for a reason");
{
  ok("every watched resource names at least one field",
     Object.entries(RESTRICTED_FIELDS).every(([r, f]) =>
       Array.isArray(f) && (f.length > 0 || r === "career" || r === "career_by_season" || r === "dismissal_breakdown")),
     Object.entries(RESTRICTED_FIELDS).filter(([, f]) => !f.length).map(([r]) => r).join(" "));
  ok("no watched field is a duplicate within its resource",
     Object.values(RESTRICTED_FIELDS).every((f) => new Set(f).size === f.length));
  ok("SENSITIVE names only real capabilities", SENSITIVE.every(isCapability));
  ok("...and has no duplicates", new Set(SENSITIVE).size === SENSITIVE.length);
  ok("...and every one of them is in ALL_CAPABILITIES",
     SENSITIVE.every((c) => ALL_CAPABILITIES.includes(c)));
}

console.log("\n" + "─".repeat(52));
console.log(`SENSITIVITY: ${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);

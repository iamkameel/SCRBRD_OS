#!/usr/bin/env node
/**
 * A Pilot Match stays in its own schema (docs/design/PILOT_MATCH_PHASE2.md
 * §2.4 item 4): no migration but the pilot migrations names a table in
 * schema `pilot`. db/151 keeps the application role out of the schema and
 * the verifier (db/99 §129) proves that a view or a function outside its
 * allow-list makes the check raise; this is the same rule read over the
 * source, so a builder writing a new view over the pilot log learns of it
 * from a red test before it reaches a database.
 *
 * Read in any case, quoted or not, with or without spaces at the dot (the
 * review's S1), over every migration and every server module. Comments are
 * stripped first: a sentence about the pilot is not a read of it. db/98_seed_pilot.sql and db/132_pilot_audit_fixes.sql are the SCHOOL
 * pilot, which shares the word and nothing else, and are held to the rule
 * like any other file.
 *
 * Falsified once: a `CREATE VIEW v AS SELECT seq FROM pilot.ball_event` put
 * into a scratch copy of db/146 turns group A red, naming the file.
 *
 *   node packages/policy/test/pilot-isolation.test.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DB = join(ROOT, "db");
const SERVICES = join(ROOT, "services");

/** The files that may name a pilot table: the pilot migrations, and the verifier that proves them. */
export const PILOT_FILES = Object.freeze(["151_pilot_match.sql", "99_rls_verify.sql"]);

/** A schema-qualified name in schema pilot: `pilot.ball_event`, `"pilot".name`, `PILOT . NAME`. */
const PILOT_REF = /(?<![\w$."])"?pilot"?\s*\.\s*"?[a-z_][\w$]*/gi;

/** SQL's comments, and a JS module's, out. @param {string} src @param {boolean} [js] */
const stripComments = (src, js = false) => src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(js ? /(^|[^:\\])\/\/[^\n]*/g : /--[^\n]*/g, js ? "$1 " : " ");

/** Every pilot reference in a file's source, comments aside. @param {string} src @param {boolean} [js] */
export const pilotRefs = (src, js = false) => [...stripComments(src, js).matchAll(PILOT_REF)].map((m) => m[0].replace(/\s+/g, ""));

/** Every .mjs under a directory, node_modules aside. @param {string} dir @returns {string[]} */
const modulesUnder = (dir) => readdirSync(dir).flatMap((f) => {
  if (f === "node_modules") return [];
  const p = join(dir, f);
  return statSync(p).isDirectory() ? modulesUnder(p) : f.endsWith(".mjs") ? [p] : [];
});

let pass = 0, fail = 0;
const ok = (/** @type {string} */ n, /** @type {unknown} */ c, d = "") => {
  console.log(`${c ? "✓" : "✗"} ${n}${c || !d ? "" : `\n    ${d}`}`);
  if (c) pass++; else fail++;
};
const group = (/** @type {string} */ t) => console.log("\n" + t);

const files = readdirSync(DB).filter((f) => f.endsWith(".sql")).sort();

group("A. No migration but the pilot's names a pilot table");
{
  const hits = files.filter((f) => !PILOT_FILES.includes(f))
    .map((f) => ({ f, refs: pilotRefs(readFileSync(join(DB, f), "utf8")) }))
    .filter((x) => x.refs.length);
  ok("every other db/*.sql is clear of schema pilot", hits.length === 0,
     hits.map((x) => `${x.f}: ${[...new Set(x.refs)].join(", ")}`).join("; "));
  ok("...and there are files to read", files.length > 100, String(files.length));
  const mods = modulesUnder(SERVICES);
  const inCode = mods.map((f) => ({ f, refs: pilotRefs(readFileSync(f, "utf8"), true) })).filter((x) => x.refs.length);
  ok("no server module names a pilot table: it calls db/151's functions", inCode.length === 0 && mods.length > 50,
     inCode.map((x) => `${x.f}: ${[...new Set(x.refs)].join(", ")}`).join("; "));
}

group("B. The pilot migration is where the schema is");
{
  const own = readFileSync(join(DB, "151_pilot_match.sql"), "utf8");
  ok("db/151 creates schema pilot, and takes it from PUBLIC and the application role",
     /CREATE SCHEMA pilot;/.test(own) && /REVOKE ALL ON SCHEMA pilot FROM PUBLIC;/.test(own) && /REVOKE ALL ON SCHEMA pilot FROM scrbrd_app;/.test(own));
  ok("...grants nothing in it to anybody", !/GRANT[^;]*\bON\s+(ALL\s+TABLES\s+IN\s+SCHEMA\s+pilot|SCHEMA\s+pilot|(TABLE\s+)?pilot\.)/i.test(stripComments(own)));
  ok("...and runs the isolation check before it ends", /SELECT pilot_isolation_check\(\);\s*$/.test(own.trimEnd() + "\n"));
  ok("the verifier calls the check, and proves a view and a function make it raise",
     /_v151_breaks\('CREATE VIEW/.test(readFileSync(join(DB, "99_rls_verify.sql"), "utf8"))
     && /_v151_breaks\(\$f\$CREATE FUNCTION/.test(readFileSync(join(DB, "99_rls_verify.sql"), "utf8")));
}

group("C. The reader itself");
{
  ok("finds a plain reference", pilotRefs("select * from pilot.ball_event").join() === "pilot.ball_event");
  ok("...a quoted one", pilotRefs(`select 1 from "pilot".name`).length === 1 && pilotRefs(`select 1 from "pilot"."name"`).length === 1);
  ok("...in capitals, and with spaces at the dot", pilotRefs("SELECT 1 FROM PILOT.NAME").length === 1 && pilotRefs("select 1 from pilot . name").length === 1);
  ok("...in a JS module's SQL, not in its comments", pilotRefs("// pilot.name\nconst q = `select * from pilot.held`;", true).join() === "pilot.held");
  ok("...not one in a comment", pilotRefs("-- reads pilot.name\n/* pilot.match */ select 1").length === 0);
  ok("...not a word that ends a sentence in a comment", pilotRefs("-- the school pilot. Then\nselect 1").length === 0);
  ok("...not another schema's column called pilot", pilotRefs("select m.pilot.x from t").length === 0
     && pilotRefs("select x.pilot from t").length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

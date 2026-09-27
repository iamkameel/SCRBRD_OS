// Every hard-coded `127.0.0.1:5432` / `localhost:5432` was replaced with an
// import from tools/db-url.mjs (the parallel-verification fix) so a worktree
// can point the whole toolchain at its own database with two environment
// variables. Nothing stops somebody adding a NEW file that hard-codes it
// again — other agents are adding walks concurrently — so this scans the
// same tree the original fix did and fails the moment one appears.
//
// tools/db-url.mjs itself is exempt: it is the one file allowed to know what
// the unshifted defaults are, and its own doc comment says so in prose.
//
// Falsified by hand: add a temporary file naming
// "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd", confirm this goes red
// naming it, then remove the file.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIRS = ["tools", "services", "packages"];
// db-url.mjs is exempt because it is the one file allowed to know the
// unshifted defaults; this file is exempt from itself because naming the
// pattern in a comment (and in PATTERN's own source) is not hard-coding it.
const EXEMPT = new Set(["tools/db-url.mjs", "tools/db-url-guard.test.mjs"]);
const PATTERN = /127\.0\.0\.1:5432|localhost:5432/;

let passes = 0, fails = 0;
const ok = (label, cond, detail = "") => { console.log(`${cond ? "✓" : "✗"} ${label}${cond || !detail ? "" : `\n    ${detail}`}`); if (cond) passes++; else fails++; };

const files = [];
for (const dir of DIRS) {
  (function walk(d) {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name === "dist") continue;
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(mjs|js)$/.test(e.name)) files.push(full);
    }
  })(join(ROOT, dir));
}

const offenders = [];
for (const file of files) {
  const rel = relative(ROOT, file).replace(/\\/g, "/");
  if (EXEMPT.has(rel)) continue;
  readFileSync(file, "utf8").split("\n").forEach((line, i) => {
    if (PATTERN.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
  });
}

ok(`no file under ${DIRS.join("/, ")}/ hard-codes 127.0.0.1:5432 or localhost:5432 outside tools/db-url.mjs`,
   offenders.length === 0, offenders.join("\n    "));

console.log(`\nDB-URL GUARD: ${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);

#!/usr/bin/env node
/**
 * Finds identifiers a module uses but never imports or declares.
 *
 * The single-file artifact was split into modules by inferring each one's
 * imports from the identifiers in its body. That inference had gaps, and the
 * gaps are invisible to the bundler: an undefined *global* is a runtime
 * ReferenceError, not a build error, so a module can compile perfectly and
 * then throw the moment a particular branch renders. `fmtOv` in the scorer was
 * exactly that — used once, deep inside a screen, missing its import since the
 * split.
 *
 * This walks every module, subtracts what it declares and imports from what it
 * uses, and flags anything left over that ANOTHER module in the project
 * exports — which is a near-certain missing import rather than a false alarm.
 *
 *   node tools/check-imports.mjs
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = "apps/web/src";

const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (/\.(jsx?|mjs)$/.test(e.name) && !/\.test\./.test(e.name)) files.push(full);
  }
})(ROOT);

/**
 * Strip everything that looks like an identifier but is not a reference:
 * comments, string bodies (keeping `${...}` interpolations), JSX text nodes,
 * and property accesses. Without the last two, `>SCRBRD<` rendered as text and
 * `ScorerApp.seedLiveResume(...)` both read as free variables.
 *
 * SPREAD/REST MUST GO FIRST. `...textOn` is three dots then a real reference
 * — the property-access strip below sees only its own single `.` alternative
 * and reads the last of the three as `.textOn`, stripping the very identifier
 * a spread exists to use: `<Btn {...textOn} />` silently checked nothing.
 * Turning `...` into blanks before that regex runs leaves the name behind it
 * exactly as bare as `...textOn` actually leaves it at runtime.
 *
 * ALL THREE KINDS OF STRING GO IN ONE PASS, in source order. They used to be
 * three passes — backticks, then single quotes, then double — and the single
 * quote pass ran over text the double-quote pass had not yet removed. An
 * apostrophe inside a double-quoted string ("a school's roster") opened a
 * phantom '…' that ran to the next apostrophe in the file, swallowing one `"`
 * on the way, and from there every double-quoted string was paired with the
 * wrong partner: their CONTENTS became code, and a word inside one of them —
 * "add SCRBRD to your home screen" — was reported as a missing import. One
 * alternation, scanned left to right, means whichever quote opens first is
 * the one that closes, which is what the language does. Single- and
 * double-quoted strings cannot span a line, so a stray apostrophe in JSX
 * text can mislead the scanner only to the end of that line.
 */
const STRING = /`(?:\\.|[^`\\])*`|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g;
const codeOf = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:\\])\/\/[^\n]*/g, "$1 ")
    .replace(STRING, (t) => (t[0] === "`" ? (t.match(/\$\{[^}]*\}/g) || []).join(" ") : " "))
    .replace(/>[^<>{}]*</g, "><")                      // JSX text nodes
    // JSX text that touches an {expression} — `>nobody can read it {x}<` —
    // which the line above cannot cross. Kept narrow on purpose: no ( ) ; =
    // inside, so an arrow body such as `if (xs.some(x => fmt(x))) {` is never
    // read as prose and its references never swallowed. The `}` form also
    // refuses a comma: `[{ default: S }, { parseBalls }]` is a destructuring
    // list, and eating its `, ` glued two parameter names into one that
    // nothing declared. Prose with brackets next to an expression is the one
    // shape left to a false positive.
    .replace(/>[^<>{}();=]*(?=[<{])/g, ">")
    .replace(/}[^<>{}();=,]*(?=[<{])/g, "}")
    .replace(/\.\.\./g, "   ")                          // spread/rest — see above
    .replace(/(\?\.|\.)\s*([A-Za-z_$][\w$]*)/g, "$1_");  // property accesses

const exportsOf = (src) => {
  const out = new Set();
  const m = src.match(/^export \{ (.+) \};$/m);
  if (m) for (const n of m[1].split(",")) out.add(n.trim().split(" as ").pop());
  for (const d of src.matchAll(/^export (?:const|function|class|let)\s+([A-Za-z_$][\w$]*)/gm)) out.add(d[1]);
  return out;
};

const importsOf = (src) => {
  const out = new Set();
  for (const m of src.matchAll(/import\s+\{([\s\S]*?)\}\s+from/g))
    for (const n of m[1].split(",")) { const t = n.trim().split(/\s+as\s+/).pop(); if (t) out.add(t); }
  for (const m of src.matchAll(/import\s+([A-Za-z_$][\w$]*)\s*(?:,|from)/g)) out.add(m[1]);
  for (const m of src.matchAll(/import\s+\*\s+as\s+([A-Za-z_$][\w$]*)/g)) out.add(m[1]);
  return out;
};

/** Everything the module binds itself: declarations, params, destructuring. */
const declaredIn = (code) => {
  const out = new Set();
  for (const m of code.matchAll(/\b(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) out.add(m[1]);
  // Destructured bindings and parameter lists, taken loosely — this set only
  // needs to avoid false positives, so over-collecting here is safe.
  for (const m of code.matchAll(/(?:const|let|var)\s*\{([^}]*)\}/g))
    for (const n of m[1].split(",")) out.add(n.trim().split(":").pop().trim().split("=")[0].trim());
  for (const m of code.matchAll(/(?:const|let|var)\s*\[([^\]]*)\]/g))
    for (const n of m[1].split(",")) out.add(n.trim().split("=")[0].trim());
  for (const m of code.matchAll(/\(([^)]*)\)\s*=>/g))
    for (const n of m[1].split(",")) out.add(n.trim().replace(/[{}[\]]/g, "").split(":").pop().split("=")[0].trim());
  for (const m of code.matchAll(/function\s*[A-Za-z_$\w]*\s*\(([^)]*)\)/g))
    for (const n of m[1].split(",")) out.add(n.trim().replace(/[{}[\]]/g, "").split(":").pop().split("=")[0].trim());
  for (const m of code.matchAll(/\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) out.add(m[1]);
  for (const m of code.matchAll(/catch\s*\(\s*([A-Za-z_$][\w$]*)/g)) out.add(m[1]);
  return out;
};

// Build the project's export index: name → the modules that export it.
const index = new Map();
const sources = new Map();
for (const f of files) {
  const src = readFileSync(f, "utf8");
  sources.set(f, src);
  for (const n of exportsOf(src)) {
    if (!index.has(n)) index.set(n, []);
    index.get(n).push(f);
  }
}

const findings = [];
for (const f of files) {
  const src = sources.get(f);
  const code = codeOf(src);
  const known = new Set([...declaredIn(code), ...importsOf(src), ...exportsOf(src)]);
  const seen = new Set();
  for (const m of code.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)) {
    const n = m[1];
    if (known.has(n) || seen.has(n) || !index.has(n)) continue;
    // A module that exports the name itself is not missing an import of it.
    if (index.get(n).includes(f)) continue;
    seen.add(n);
    findings.push({ file: relative(ROOT, f), name: n, from: relative(ROOT, index.get(n)[0]) });
  }
}

for (const { file, name, from } of findings) {
  console.log(`✗ ${file}: uses "${name}" (exported by ${from}) but does not import it`);
}
console.log(`\n${"─".repeat(52)}\nIMPORT CHECK: ${files.length} modules, ${findings.length} missing import${findings.length === 1 ? "" : "s"}`);
process.exit(findings.length ? 1 : 0);

#!/usr/bin/env node
/**
 * Nothing confidential is in the shipped client.
 *
 * WHY THIS RUNS RATHER THAN BEING WRITTEN DOWN. "The rewards coefficients are
 * server-side" is a sentence, and a sentence cannot fail. One `import` in a
 * view — added by somebody who needed a label and reached for the nearest
 * module that had one — puts the whole algorithm in a text file served to
 * every visitor, and no test in this project would have noticed. This is the
 * same shape as tools/check-imports.mjs and the unlisted-walk check in
 * run-smoke-api.mjs: replace the paragraph somebody has to keep true with an
 * assertion that keeps it.
 *
 * It reads the BUILT bundle, not the source, because that is the artefact that
 * actually leaves the building. A source-level import check would miss a value
 * inlined by a bundler, a string assembled at build time, or a sourcemap.
 *
 * WHAT COUNTS AS A LEAK. Not just a coefficient's value — its NAME too. That
 * the algorithm weighs growth against current rating at all is the interesting
 * half, and `reward.growth` appearing in a bundle discloses the shape of the
 * thing to anybody who opens dev tools.
 *
 *   node tools/check-bundle.mjs        (after pnpm build)
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { WEIGHT_KEYS } from "../services/api/rewards/weights.mjs";

const DIST = "apps/web/dist";

// ── What must never appear in a shipped asset ──
//
// The coefficient names come from the server module itself rather than being
// re-typed here, so adding a term to the algorithm extends this check
// automatically. A hand-maintained second list is the drift this project keeps
// finding in other people's repositories.
const FORBIDDEN = [
  ...Object.values(WEIGHT_KEYS),
  // The identifiers themselves. If any of these is in the bundle, something
  // under services/api/rewards was imported by the client — which is the
  // mistake this check exists for, even if the values never resolved.
  "WEIGHT_KEYS",
  "reward_weight_at",
  "reward_weight",
];

// Assets a browser can fetch. Sourcemaps included ON PURPOSE: a .map file is
// the original module text, served from the same directory, and a check that
// skipped them would pass while the whole module sat next to the bundle.
const CHECKED = /\.(js|mjs|cjs|css|html|json|map|txt)$/i;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (CHECKED.test(name)) out.push(p);
  }
  return out;
}

if (!existsSync(DIST)) {
  console.error(`\n✗ ${DIST} does not exist — run \`pnpm build\` first.`);
  console.error("  Refusing to pass: a check that silently skips when there is nothing");
  console.error("  to check is how a bundle assertion stops being one.");
  process.exit(1);
}

// ── The bundler-independent half ──
//
// Learned from falsifying this check. Importing the module into a view and
// assigning it to an unused export was caught ONLY in the sourcemap: the
// minifier had renamed the identifier and tree-shaken the strings out of the
// JavaScript itself. A real use does land in the bundle — verified — but a
// build with sourcemaps off and a leak the optimiser happens to fold away
// would pass a scan of the output alone.
//
// So the output scan is the belt and this is the braces: no file the client
// builds from may import from the server's rewards directory at all. Source
// text, so no optimiser gets a say.
function sourceImportsRewards() {
  const SRC = "apps/web/src";
  if (!existsSync(SRC)) return [];
  const bad = [];
  const src = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { src(p); continue; }
      if (!/\.(js|jsx|mjs|ts|tsx)$/i.test(name)) continue;
      const text = readFileSync(p, "utf8");
      // Any mention of the path, however it is spelled — a relative climb, an
      // alias, a dynamic import.
      if (/services\/api\/rewards/.test(text)) bad.push(relative(".", p));
    }
  };
  src(SRC);
  return bad;
}

const reaching = sourceImportsRewards();

const files = walk(DIST);
if (!files.length) {
  console.error(`\n✗ ${DIST} contains no checkable assets — the build produced nothing.`);
  process.exit(1);
}

const findings = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const needle of FORBIDDEN) {
    let at = text.indexOf(needle);
    while (at !== -1) {
      // A little context, so a finding is diagnosable without opening a
      // minified file by hand.
      findings.push({ file: relative(".", file), needle,
                      context: text.slice(Math.max(0, at - 60), at + needle.length + 60) });
      at = text.indexOf(needle, at + needle.length);
      if (findings.length > 20) break;
    }
    if (findings.length > 20) break;
  }
}

console.log("\n" + "─".repeat(52));
if (reaching.length) {
  console.error("✗ THE CLIENT CAN REACH THE SERVER'S REWARDS MODULE\n");
  for (const f of reaching) console.error(`  ${f} mentions services/api/rewards`);
  console.error("\n  Nothing the browser builds from may import it — see the note in");
  console.error("  services/api/rewards/weights.mjs. The figure and its bands come from");
  console.error("  the API; the weights never leave the server.");
  process.exit(1);
}
if (findings.length) {
  console.error(`✗ CONFIDENTIAL MATERIAL IN THE CLIENT BUNDLE — ${findings.length} occurrence(s)\n`);
  for (const f of findings.slice(0, 10)) {
    console.error(`  ${f.file}: "${f.needle}"`);
    console.error(`    …${f.context.replace(/\s+/g, " ")}…`);
  }
  console.error("\n  Something under services/api/rewards is reachable from apps/web.");
  console.error("  The fix is never to rename the constant: move the use to the server and");
  console.error("  have the API return the FIGURE and its bands, never the weights.");
  process.exit(1);
}
// ── The Firebase SDK is not in the chunk every visitor downloads ──
//
// Analytics runs only on a device that consented (lib/firebase.js), and the
// point of a dynamic import is that the SDK is not fetched before then. The
// bundler could undo that silently — a static import added anywhere in the
// entry graph folds firebase/app back into the main chunk and nothing would
// look different. So: the largest index-*.js must not carry the SDK's own
// package names, and some other asset must, or the SDK went missing entirely.
const js = files.filter((f) => /\.js$/.test(f) && !/\.map$/.test(f));
// The entry chunk is the one index.html loads — not "the largest index-*.js",
// which it used to be: the scorer's chunk is ALSO named index-* (it comes from
// scorer/index.jsx), and the day it outgrew the entry this check would have
// measured the wrong file and passed.
const html = readFileSync(join(DIST, "index.html"), "utf8");
const entryName = html.match(/<script[^>]+type="module"[^>]+src="\/?assets\/(index-[^"]+\.js)"/)?.[1];
const entry = entryName ? js.find((f) => f.endsWith(entryName)) : undefined;
const SDK = ["@firebase/app", "@firebase/analytics"];
const entryText = entry ? readFileSync(entry, "utf8") : "";
const inEntry = SDK.filter((m) => entryText.includes(m));
const elsewhere = SDK.filter((m) => js.some((f) => f !== entry && readFileSync(f, "utf8").includes(m)));
if (!entry || inEntry.length || elsewhere.length !== SDK.length) {
  console.error(`✗ FIREBASE SDK PLACEMENT — entry chunk ${entry ? relative(".", entry) : "(none)"}`);
  if (inEntry.length) console.error(`  in the entry chunk: ${inEntry.join(", ")} — a static import of firebase/* reached the entry graph`);
  if (elsewhere.length !== SDK.length) console.error(`  not found in any other chunk: ${SDK.filter((m) => !elsewhere.includes(m)).join(", ")}`);
  process.exit(1);
}
// ── The screens are not in the chunk every visitor downloads either ──
//
// SCRBRD-020. The views and the scorer are fetched on first use (App.jsx);
// before that, one 936 KB chunk carried every screen to every visitor. The
// same thing that could undo the Firebase split undoes this one: a static
// import of a view, or of any scorer module from something in the entry
// graph, folds it straight back into the entry chunk and the build still
// succeeds. So the entry chunk has a ceiling, and one string from a view and
// one from the scorer must be absent from it and present in some other chunk
// — the second half so that the check cannot pass because a screen went
// missing altogether.
//
// Falsified three ways when written. A real static use of the scorer from the
// landing page: red on both the ceiling (559 KB) and the scorer marker. A
// static view in App.jsx: red on the view marker. And an UNUSED import of the
// scorer's engine — two of which the auth pages had carried since the split —
// grew the entry by 31 KB and tripped nothing: Rollup keeps a module's
// side-effecting top level for an import it cannot prove pure, but drops the
// rest, so the marker is not reached. The ceiling is what bounds that kind of
// creep; the markers are for the whole-screen kind.
const ENTRY_LIMIT_KB = 500;
const OUTSIDE_ENTRY = [
  ["a view (SettingsView)",  "dob-gaps"],
  ["the scorer (sheets.jsx)", "revise-target"],
];
const others = js.filter((f) => f !== entry).map((f) => readFileSync(f, "utf8"));
const entryKB = Math.round(statSync(entry).size / 1024);
const splitProblems = [];
if (entryKB > ENTRY_LIMIT_KB) splitProblems.push(`the entry chunk is ${entryKB} KB; the ceiling is ${ENTRY_LIMIT_KB} KB`);
for (const [what, marker] of OUTSIDE_ENTRY) {
  if (entryText.includes(marker)) splitProblems.push(`${what} is in the entry chunk ("${marker}" found there) — something in the entry graph imports it statically`);
  else if (!others.some((t) => t.includes(marker))) splitProblems.push(`${what} is in no chunk at all ("${marker}" not found) — the marker or the screen went missing`);
}
if (splitProblems.length) {
  console.error(`✗ CODE SPLITTING UNDONE — entry chunk ${relative(".", entry)}`);
  for (const p of splitProblems) console.error(`  ${p}`);
  console.error("\n  Views and the scorer are lazy in apps/web/src/App.jsx. Find the static import");
  console.error("  that reaches them from the entry graph (grep for scorer/ and views/ outside");
  console.error("  those directories) and make it dynamic or delete it.");
  process.exit(1);
}
console.log(`BUNDLE CHECK: ${files.length} assets, ${FORBIDDEN.length} markers, 0 leaks · no client source reaches the rewards module · Firebase SDK, the views and the scorer outside the ${entryKB} KB entry chunk (ceiling ${ENTRY_LIMIT_KB} KB)`);
process.exit(0);

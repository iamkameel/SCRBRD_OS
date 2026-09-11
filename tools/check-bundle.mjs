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
console.log(`BUNDLE CHECK: ${files.length} assets, ${FORBIDDEN.length} markers, 0 leaks · no client source reaches the rewards module`);
process.exit(0);

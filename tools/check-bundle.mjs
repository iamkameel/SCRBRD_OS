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
import { join, relative, dirname } from "node:path";
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
// ── The browser walks' test hook is not in the shipped client ──
//
// ui/ErrorBoundary.jsx lets a walk make one panel throw
// (window.__SCRBRD_TEST_THROW__), but only in a build made with
// SCRBRD_TEST_HOOKS=1: vite.config.js `define`s the flag to `false` otherwise
// and the hook is dead code, dropped by the minifier. Sourcemaps are left out
// of THIS scan on purpose — they carry the original module text, hook and all,
// which is not code that runs. The second half, the boundary's own card being
// in the build, is so this cannot pass because the boundary went missing.
{
  const HOOK = "__SCRBRD_TEST_THROW__";
  const code = files.filter((f) => !/\.map$/.test(f));
  const hooked = code.filter((f) => readFileSync(f, "utf8").includes(HOOK));
  const boundaries = code.some((f) => readFileSync(f, "utf8").includes("panel-error"));
  if (hooked.length || !boundaries) {
    console.error("✗ THE TEST HOOK IS IN THE SHIPPED CLIENT, OR THE ERROR BOUNDARY IS NOT\n");
    for (const f of hooked) console.error(`  ${relative(".", f)} contains ${HOOK}`);
    if (!boundaries) console.error('  no asset contains the boundary\'s card ("panel-error") — ui/ErrorBoundary.jsx is not in the build');
    console.error("\n  Build without SCRBRD_TEST_HOOKS (the walks make their own apps/web/dist-test).");
    process.exit(1);
  }
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

// THE ENTRY IS ITS STATIC GRAPH, not its one file (SCRBRD-083). The build has
// two entries since the public pages' bundle arrived (vite.config.js), and
// Rollup puts what both share — React, the tokens — in a chunk the app's
// entry imports statically. A view folded into that shared chunk would be
// downloaded by every visitor exactly as if it were in the entry file, and a
// check of the entry file alone would pass it. So every check below reads the
// entry together with every chunk it imports statically (never a dynamic
// import(), which is the split working), and the ceiling is the whole of it.
const STATIC_IMPORT = /\bimport\s*(?:[^"'();]*?\bfrom\s*)?["'](\.{1,2}\/[^"']+\.js)["']/g;
/** An entry file and every chunk reachable from it by static import. @param {string} file */
function staticGraph(file) {
  const seen = new Set();
  const todo = [file];
  while (todo.length) {
    const f = todo.pop();
    if (seen.has(f) || !existsSync(f)) continue;
    seen.add(f);
    for (const m of readFileSync(f, "utf8").matchAll(STATIC_IMPORT)) todo.push(join(dirname(f), m[1]));
  }
  return [...seen];
}
const entryGraph = entry ? staticGraph(entry) : [];
const SDK = ["@firebase/app", "@firebase/analytics"];
const entryText = entryGraph.map((f) => readFileSync(f, "utf8")).join("\n");
const inEntry = SDK.filter((m) => entryText.includes(m));
const elsewhere = SDK.filter((m) => js.some((f) => !entryGraph.includes(f) && readFileSync(f, "utf8").includes(m)));
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
const others = js.filter((f) => !entryGraph.includes(f)).map((f) => readFileSync(f, "utf8"));
const entryKB = Math.round(entryGraph.reduce((n, f) => n + statSync(f).size, 0) / 1024);
const splitProblems = [];
if (entryKB > ENTRY_LIMIT_KB) splitProblems.push(`the entry chunk and its static imports are ${entryKB} KB; the ceiling is ${ENTRY_LIMIT_KB} KB`);
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
// ── The public pages carry nothing signed-in (SCRBRD-083) ──
//
// /public-app.js is what a stranger's browser loads from /live/:match and
// /scorecard/:match. Its static graph must hold none of the app a signed-in
// person uses: not the scorer, not a view, not the App shell, not the API
// client that sends a bearer token, not the governed read path, not a
// signed-in match route, not the Firebase SDK, not the service worker. Each
// marker must still be found somewhere else in the build, so the check cannot
// pass because a marker went stale. And the bundle must be the public one:
// it reads /api/public/matches/.
//
// SCRBRD-133 G1: the ground display is a LAZY chunk of the same bundle
// (/display/:match), which a static graph never reaches — so a signed-in
// marker folded into it would pass a check of the static graph alone. Every
// marker below is therefore held out of the WHOLE public graph: the entry,
// its static imports, and every chunk it or they import dynamically, and
// theirs. And the display must be that lazy chunk: its marker absent from the
// static graph (the live page does not pay for it) and present in the whole
// one (it was not lost). The static graph has a ceiling of its own.
const PUBLIC_ENTRY = join(DIST, "public-app.js");
const DYNAMIC_IMPORT = /\bimport\(\s*["'](\.{1,2}\/[^"']+\.js)["']\s*\)/g;
/** An entry file and every chunk reachable from it by static OR dynamic import. @param {string} file */
function wholeGraph(file) {
  const seen = new Set();
  const todo = [file];
  while (todo.length) {
    const f = todo.pop();
    if (seen.has(f) || !existsSync(f)) continue;
    seen.add(f);
    const text = readFileSync(f, "utf8");
    for (const m of text.matchAll(STATIC_IMPORT)) todo.push(join(dirname(f), m[1]));
    for (const m of text.matchAll(DYNAMIC_IMPORT)) todo.push(join(dirname(f), m[1]));
  }
  return [...seen];
}
/** The display's own marker: its rotating panel area's test id (display/DisplayView.jsx). */
const DISPLAY_MARKER = "display-panel-partnership";
/** The public entry's static graph: React, the tokens, the fold, the live page — not the display. Measured 447 KB on 2026-10-02. */
const PUBLIC_LIMIT_KB = 470;
const NOT_PUBLIC = [
  ["the scorer (sheets.jsx)",            "revise-target"],
  ["a view (SettingsView)",              "dob-gaps"],
  ["the signed-in shell (App.jsx)",      "demo-banner-signin"],
  ["the API client (lib/api.js)",        "Bearer "],
  ["the governed read path",             "/api/read/"],
  ["a signed-in match route",            "/api/matches/"],
  ["the Firebase SDK",                   "@firebase/app"],
  ["the service worker's registration",  "serviceWorker"],
];
const publicProblems = [];
let publicKB = 0, publicWholeKB = 0;
if (!existsSync(PUBLIC_ENTRY)) {
  publicProblems.push("dist/public-app.js is missing — the public pages have no bundle (vite.config.js's `public` entry)");
} else {
  const graph = staticGraph(PUBLIC_ENTRY);
  const whole = wholeGraph(PUBLIC_ENTRY);
  publicKB = Math.round(graph.reduce((n, f) => n + statSync(f).size, 0) / 1024);
  publicWholeKB = Math.round(whole.reduce((n, f) => n + statSync(f).size, 0) / 1024);
  const staticText = graph.map((f) => readFileSync(f, "utf8")).join("\n");
  const text = whole.map((f) => readFileSync(f, "utf8")).join("\n");
  const rest = js.filter((f) => !whole.includes(f)).map((f) => readFileSync(f, "utf8"));
  if (!staticText.includes("/api/public/matches/")) publicProblems.push("public-app.js does not read /api/public/matches/ — it is not the public bundle");
  for (const [what, marker] of NOT_PUBLIC) {
    if (text.includes(marker)) publicProblems.push(`${what} is in the public pages' graph, static or lazy ("${marker}" found)`);
    else if (!rest.some((t) => t.includes(marker))) publicProblems.push(`${what}'s marker "${marker}" is in no chunk at all — the marker went stale`);
  }
  if (staticText.includes(DISPLAY_MARKER)) publicProblems.push(`the ground display is in the public entry's static graph ("${DISPLAY_MARKER}" found) — /live pays for it; import it lazily (public/main.jsx)`);
  else if (!text.includes(DISPLAY_MARKER)) publicProblems.push(`the ground display is in no chunk the public entry reaches ("${DISPLAY_MARKER}" not found) — the marker or the display went missing`);
  if (publicKB > PUBLIC_LIMIT_KB) publicProblems.push(`the public entry's static graph is ${publicKB} KB; the ceiling is ${PUBLIC_LIMIT_KB} KB`);
}
if (publicProblems.length) {
  console.error("✗ THE PUBLIC PAGES' BUNDLE REACHES THE SIGNED-IN APP");
  for (const p of publicProblems) console.error(`  ${p}`);
  console.error("\n  apps/web/src/public/ may import only what a signed-out page draws: the Match");
  console.error("  Centre's shared tabs (tabs-core.jsx, scorecard.jsx, banners.jsx), lib/matchCentre.js,");
  console.error("  the design tokens and @scrbrd/scoring. Find the static import that reaches the rest.");
  process.exit(1);
}
// ── The home page carries nothing signed-in either (SCRBRD-142) ──
//
// home.html is what a stranger's phone loads at / — the front door, which
// search engines may index. Its graph, static AND lazy, must hold none of the
// eight markers above: no scorer, no view, no App shell, no API client, no
// governed read, no signed-in match route, no Firebase SDK (the analytics
// switch in its footer only sets the device's preference, lib/persist.js),
// no service worker. It must be the home bundle: it reads /api/public/live.
// It must not carry the public pages' fold either — a stranger reading a
// pitch does not download the scorer's engine — which the ceiling bounds: it
// was measured at the first build, React and the tokens (§6.2, A9). And the
// HTML stays small (A9: < 15 KB): it paints before any script.
const HOME_HTML = join(DIST, "home.html");
/**
 * The home entry's whole graph. Measured 2026-10-02: 166 KB with placeholder
 * sections; 249 KB with the sections mounted, of which the shared chunk is
 * 222 KB — React, the tokens and ui/icons.jsx (the Tiles' icons, ~44 KB) —
 * the home chunk 23 KB and lib/persist.js 3 KB. Over A9's ~220 KB guess by the
 * icon vocabulary; a home-only icon set is the lever if it must come down.
 */
const HOME_LIMIT_KB = 260;
const HOME_HTML_LIMIT_KB = 15;
const homeProblems = [];
let homeKB = 0;
if (!existsSync(HOME_HTML)) {
  homeProblems.push("dist/home.html is missing — the home page has no build (vite.config.js's `home` entry)");
} else {
  const page = readFileSync(HOME_HTML, "utf8");
  const homeName = page.match(/<script[^>]+type="module"[^>]+src="\/?assets\/(home-[^"]+\.js)"/)?.[1];
  const homeEntry = homeName ? js.find((f) => f.endsWith(homeName)) : undefined;
  if (!homeEntry) homeProblems.push("dist/home.html loads no assets/home-*.js — the home entry did not build");
  else {
    const whole = wholeGraph(homeEntry);
    homeKB = Math.round(whole.reduce((n, f) => n + statSync(f).size, 0) / 1024);
    const text = whole.map((f) => readFileSync(f, "utf8")).join("\n");
    const rest = js.filter((f) => !whole.includes(f)).map((f) => readFileSync(f, "utf8"));
    if (!text.includes("/api/public/live")) homeProblems.push("the home graph does not read /api/public/live — it is not the home bundle");
    for (const [what, marker] of NOT_PUBLIC) {
      if (text.includes(marker)) homeProblems.push(`${what} is in the home page's graph, static or lazy ("${marker}" found)`);
      else if (!rest.some((t) => t.includes(marker))) homeProblems.push(`${what}'s marker "${marker}" is in no chunk outside the home graph — the marker went stale`);
    }
    if (text.includes(DISPLAY_MARKER)) homeProblems.push(`the ground display is in the home page's graph ("${DISPLAY_MARKER}" found)`);
    if (homeKB > HOME_LIMIT_KB) homeProblems.push(`the home page's graph is ${homeKB} KB; the ceiling is ${HOME_LIMIT_KB} KB`);
  }
  const htmlKB = Buffer.byteLength(page) / 1024;
  if (htmlKB > HOME_HTML_LIMIT_KB) homeProblems.push(`dist/home.html is ${htmlKB.toFixed(1)} KB; the ceiling is ${HOME_HTML_LIMIT_KB} KB`);
}
if (homeProblems.length) {
  console.error("✗ THE HOME PAGE'S BUNDLE REACHES THE SIGNED-IN APP, OR OUTGREW ITSELF");
  for (const p of homeProblems) console.error(`  ${p}`);
  console.error("\n  apps/web/src/home/ may import only what a signed-out page draws: the design");
  console.error("  tokens, the theme, lib/persist.js's preferences and its own reads (home/reads.js).");
  console.error("  Not public/reads.js (the fold), not lib/firebase.js, not lib/api.js.");
  process.exit(1);
}
console.log(`BUNDLE CHECK: ${files.length} assets, ${FORBIDDEN.length} markers, 0 leaks · no client source reaches the rewards module · Firebase SDK, the views and the scorer outside the ${entryKB} KB entry graph (ceiling ${ENTRY_LIMIT_KB} KB) · the public pages' graph (${publicKB} KB static, ceiling ${PUBLIC_LIMIT_KB} KB; ${publicWholeKB} KB with the lazy ground display) holds none of the ${NOT_PUBLIC.length} signed-in markers · nor does the home page's (${homeKB} KB, ceiling ${HOME_LIMIT_KB} KB)`);
process.exit(0);

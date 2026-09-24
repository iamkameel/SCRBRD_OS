#!/usr/bin/env node
/**
 * `pnpm typecheck` — TypeScript over the JavaScript, strict, on a ratchet.
 *
 * tsconfig.json's `include` is the strict list. tsc loads those files and
 * everything they import; this script fails on any error inside the list and
 * ignores errors in files outside it (a package in the list that imports
 * @scrbrd/scoring pulls scoring's source into the program, and scoring is not
 * on the list yet). Those out-of-scope errors are counted, never printed —
 * they are the next package's work, not this one's. A file under tsconfig's
 * `exclude` is out of scope the same way, though its directory is on the list.
 *
 * An error with no file (a broken tsconfig, a missing @types package) always
 * fails.
 *
 *   node tools/typecheck.mjs            check; exit 1 on any in-scope error
 *   node tools/typecheck.mjs --all      also print the out-of-scope errors
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * tsconfig.json, parsed. It is JSON plus full-line // comments, and nothing
 * else — keep it that way, or teach this function more.
 * @returns {{include: string[], exclude?: string[], compilerOptions: Record<string, unknown>}}
 */
export function tsconfig() {
  return JSON.parse(readFileSync(join(ROOT, "tsconfig.json"), "utf8")
    .split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n"));
}

/** The `include` globs: the strict list. */
export const strictList = () => tsconfig().include;

/** "packages/policy/src/**\/*.mjs" → "packages/policy/src/" */
export const prefixOf = (/** @type {string} */ glob) => glob.slice(0, glob.search(/[*?[{]|$/));

/** The `exclude` globs: holes in the strict list, each one a file still to bring in. */
export const excludedList = () => /** @type {string[]} */ (tsconfig().exclude ?? []);

/**
 * Does a path fall under an `exclude` glob? Only the two shapes the list uses:
 * a literal path (a file, or a directory and everything in it) and a leading
 * `**\/` meaning "at any depth".
 * @param {string} file @param {string} glob
 */
export function excludes(file, glob) {
  const lit = (/** @type {string} */ s) => s.replace(/[.+^${}()|[\]\\?*]/g, "\\$&");
  const body = glob.startsWith("**/") ? `(?:^|.*/)${lit(glob.slice(3))}` : `^${lit(glob)}`;
  return new RegExp(`${body}(?:/|$)`).test(file);
}

function main() {
  const prefixes = strictList().map(prefixOf);
  const holes = excludedList();
  const tsc = join(ROOT, "node_modules", "typescript", "bin", "tsc");
  const r = spawnSync(process.execPath, [tsc, "-p", join(ROOT, "tsconfig.json"), "--pretty", "false"],
    { cwd: ROOT, encoding: "utf8" });
  if (r.error) throw r.error;

  // One diagnostic per unindented line; continuation lines are indented.
  /** @type {{file: string|null, text: string}[]} */
  const diags = [];
  for (const line of (r.stdout + r.stderr).split("\n")) {
    if (!line.trim()) continue;
    if (/^\s/.test(line) && diags.length) { diags[diags.length - 1].text += "\n" + line; continue; }
    const m = /^(.+?)\(\d+,\d+\): (error|warning)/.exec(line);
    diags.push({ file: m ? m[1].replaceAll("\\", "/") : null, text: line });
  }

  const inScope = diags.filter(({ file }) => file == null
    || (prefixes.some((p) => file.startsWith(p)) && !holes.some((g) => excludes(file, g))));
  const outside = diags.length - inScope.length;
  const all = process.argv.includes("--all");

  for (const d of all ? diags : inScope) console.log(d.text);
  if (r.status !== 0 && diags.length === 0) {
    console.error(`tsc exited ${r.status} with no diagnostics:\n${r.stdout}${r.stderr}`);
    process.exit(1);
  }
  console.log(`typecheck: ${inScope.length} error(s) in the strict list (${prefixes.join(", ")}); `
    + `${outside} outside it, not counted${all ? "" : " (--all to see them)"}`);
  process.exit(inScope.length ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();

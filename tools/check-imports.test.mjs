// SCRBRD-021. check-imports.mjs's own acceptance test: a deliberately broken
// import in a scratch file is reported, and the real tree stays at zero.
//
// The scratch files are written into apps/web/src itself — the tool's ROOT is
// hardcoded, and a fixture outside it would prove nothing about the tokeniser
// that actually runs against the project. Written and removed in the same
// try/finally so a failed assertion never leaves one behind.
import { spawnSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "check-imports.mjs");
const ROOT = join(HERE, "..", "apps/web/src");

let passes = 0, fails = 0;
const ok = (label, cond, detail = "") => { console.log(`${cond ? "✓" : "✗"} ${label}${cond || !detail ? "" : `\n    ${detail}`}`); if (cond) passes++; else fails++; };

const run = () => spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });

const withScratch = (name, body, fn) => {
  const path = join(ROOT, name);
  writeFileSync(path, body);
  try { return fn(); } finally { unlinkSync(path); }
};

// ── The clean tree ──────────────────────────────────────
{
  const r = run();
  ok("the real tree reports zero missing imports", r.status === 0 && /, 0 missing import/.test(r.stdout), r.stdout);
}

// ── A plain missing import ──────────────────────────────
withScratch("__ci_probe_plain__.jsx", `
import { D } from "../design/tokens.js";
export function Probe() { return textOn(D); }
`, () => {
  const r = run();
  ok("a plain undeclared reference to a real export is caught",
     r.status === 1 && /uses "textOn"/.test(r.stdout), r.stdout);
});

// ── The spread/rest regression ───────────────────────────
// `{...textOn}` is three dots then a reference. The property-access strip
// used to read the last dot as `.textOn` — ordinary member access — and
// erase the very name a spread exists to use, so this returned 0 findings
// right alongside the two lines above it turning red. Falsified by
// reverting the fix locally and confirming this exact case goes to 0.
withScratch("__ci_probe_spread__.jsx", `
import { D } from "../design/tokens.js";
import { Btn } from "../ui/primitives.jsx";
export function Probe() { return <Btn {...textOn} />; }
`, () => {
  const r = run();
  ok("a name reached only through {...spread} is still caught",
     r.status === 1 && /uses "textOn"/.test(r.stdout), r.stdout);
});

// A name genuinely declared before being spread must NOT be flagged — the
// fix strips the dots of `...`, not the identifier after a real one.
withScratch("__ci_probe_spread_ok__.jsx", `
export function Probe(textOn) { return { ...textOn }; }
`, () => {
  const r = run();
  ok("a locally-declared name spread with {...x} is not a false positive",
     r.status === 0 && !/__ci_probe_spread_ok__/.test(r.stdout), r.stdout);
});

console.log(`\nCHECK-IMPORTS SELF-TEST: ${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);

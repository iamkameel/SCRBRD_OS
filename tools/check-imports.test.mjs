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

// ── Strings are stripped in source order ────────────────
// Two apostrophes inside double-quoted strings, then a real export's name
// inside a later double-quoted string. With the quote kinds stripped in
// separate passes the single-quote pass matched 's roster, a parent' first,
// took one `"` with it, and every double-quoted string after that was paired
// wrongly — so "textOn" here was code, and a finding. Found in the real tree
// the moment an unused import that had been masking it was deleted.
withScratch("__ci_probe_quotes__.jsx", `
const a = "a school's roster, a parent's view";
const b = "add textOn to your home screen";
export function Probe() { return a + b; }
`, () => {
  const r = run();
  ok("an apostrophe inside a double-quoted string does not turn later strings into code",
     r.status === 0 && !/__ci_probe_quotes__/.test(r.stdout), r.stdout);
});

// The same file with the reference outside the string is still caught: the
// fix narrows what counts as a string, it does not widen it.
withScratch("__ci_probe_quotes_bad__.jsx", `
const a = "a school's roster, a parent's view";
export function Probe() { return textOn(a); }
`, () => {
  const r = run();
  ok("...while a bare reference after such strings is still reported",
     r.status === 1 && /__ci_probe_quotes_bad__.*uses "textOn"/.test(r.stdout), r.stdout);
});

// ── JSX text next to an {expression} ────────────────────
// `>…nobody can read it {x}<` is prose, but the text-node strip stops at the
// brace and left "can" — an export of rbac/index.js — standing as code. Found
// in the real tree by the fix above: the phantom string had been hiding it.
withScratch("__ci_probe_prose__.jsx", `
export function Probe({ x }) { return <p>Without an account nobody can read it {x} either.</p>; }
`, () => {
  const r = run();
  ok("prose beside an {expression} is not read as a reference",
     r.status === 0 && !/__ci_probe_prose__/.test(r.stdout), r.stdout);
});

withScratch("__ci_probe_prose_bad__.jsx", `
export function Probe({ x }) { return <p>{can(x)} either.</p>; }
`, () => {
  const r = run();
  ok("...while a real call inside the braces is still reported",
     r.status === 1 && /__ci_probe_prose_bad__.*uses "can"/.test(r.stdout), r.stdout);
});

// A destructuring list is not prose. The first cut of the strip above ate
// the `, ` between two patterns and App.jsx's dynamic-import handler lost a
// parameter name to it.
withScratch("__ci_probe_destructure__.jsx", `
export function Probe(p) { return p.then(([{ default: S }, { textOn }]) => textOn(S)); }
`, () => {
  const r = run();
  ok("a name bound by destructuring after a `}, {` is still declared",
     r.status === 0 && !/__ci_probe_destructure__/.test(r.stdout), r.stdout);
});

console.log(`\nCHECK-IMPORTS SELF-TEST: ${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);

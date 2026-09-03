#!/usr/bin/env node
/**
 * The design tokens, checked as numbers.
 *
 * §5.2 of the design audit computed every token against WCAG AA and found
 * three failures: textMuted on every surface, indigo — the brand colour —
 * as body text on every surface, and violet/rose on the darker ones.
 *
 * Those are fixed. This exists so they stay fixed, because a contrast failure
 * is invisible to everyone who is not experiencing it: nothing renders wrong,
 * nothing throws, and the person who cannot read the label is not the person
 * choosing the colour.
 *
 * The rule it enforces is a token PAIR, not a replacement — `indigo` for fills
 * and borders, `indigoText` for anything read. Lightening the fill instead
 * would have washed the brand out.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../src");
const tokens = readFileSync(join(SRC, "design/tokens.js"), "utf8");

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${d}` : ""); } };
const group = (t) => console.log("\n" + t);

const HEX = Object.fromEntries([...tokens.matchAll(/(\w+):"(#[0-9a-fA-F]{6})"/g)].map((m) => [m[1], m[2]]));
const lum = (h) => {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const SURFACES = ["bg", "surf0", "surf1", "surf2", "surf3"].filter((k) => HEX[k]).map((k) => HEX[k]);
const worst = (c) => Math.min(...SURFACES.map((s) => ratio(c, s)));

group("Every token used as text clears AA on every surface");
// 4.5:1 is the threshold for body text. Large display type would allow 3:1,
// but these tokens are used at 10-13px far more often than they are used big.
for (const t of ["textPrimary", "textSecondary", "textMuted", "indigoText", "violetText", "roseText", "sky", "emerald", "amber", "orange"]) {
  if (!HEX[t]) { ok(`${t} exists`, false); continue; }
  ok(`${t} reads at ${worst(HEX[t]).toFixed(2)}:1`, worst(HEX[t]) >= 4.5);
}

group("The fill/text pairing is real, not cosmetic");
for (const [fill, text] of [["indigo", "indigoText"], ["violet", "violetText"], ["rose", "roseText"]]) {
  ok(`${text} exists as the readable half of ${fill}`, !!HEX[text]);
  ok(`...and is genuinely lighter than ${fill}`, HEX[text] && lum(HEX[text]) > lum(HEX[fill]));
}

group("No accent is used as running text");
// The pairing only helps if the code honours it. `color:D.indigo` is the
// failure this catches: same brand, unreadable at 11px on a card.
const files = [];
(function walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.jsx?$/.test(e.name)) files.push(p);
  }
})(SRC);
let raw = [];
for (const f of files) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/(?<![A-Za-z])color:D\.(indigo|violet|rose)\b(?!Text)/g)) {
    // A colour that is DATA — a shot category, a role identity — is declared
    // with the fill value and passed through textOn() where it becomes text.
    // That is the pairing working, not a violation of it.
    if (/\bcat:|\brole:|^\s*(label|id):/m.test(src.slice(Math.max(0, m.index - 120), m.index))) continue;
    raw.push(`${f.replace(SRC, "src")}: ${m[0]}`);
  }
}
ok("no fill-only accent is set as a text colour", raw.length === 0, raw.slice(0, 3).join(" · "));

group("The scoring pad's captions are legible");
// §6.3 — the audit's highest-priority visual fix. These are read by an
// untrained volunteer, outdoors, in sunlight, under time pressure, where a
// mistap is unrecoverable data loss. They were 7px at 2.26:1.
const scoring = readFileSync(join(SRC, "scorer/scoring.jsx"), "utf8");
const keyCaption = scoring.match(/\{sub&&<span[^>]*fontSize:"(\d+)px"[^>]*letterSpacing:"([^"]+)"/);
ok("the key caption is at least 10px", keyCaption && Number(keyCaption[1]) >= 10, keyCaption?.[1] + "px");
ok("...and the 0.12em tracking is gone", keyCaption && parseFloat(keyCaption[2]) <= 0.05, keyCaption?.[2]);
ok("nothing on the pad is 7px any more", !/fontSize:"7px"/.test(scoring));

group("The pairing is applied where colour is data");
// A colour chosen from a table — a shot category, a role — is still text when
// it lands in a label, and the call site cannot know which value it got. That
// is what textOn() is for, and using it is the check.
const usesTextOn = files.filter((f) => /textOn\(/.test(readFileSync(f, "utf8")));
ok("textOn is used where accents become text", usesTextOn.length > 0);
ok("the scoring surface routes its accents through it",
   usesTextOn.some((f) => /scoring\.jsx$/.test(f)));

group("The palette is closed");
// A fixed palette only works if nothing invents a thirteenth accent.
const adhoc = new Set();
for (const f of files) {
  for (const m of readFileSync(f, "utf8").matchAll(/#([0-9a-fA-F]{6})\b/g)) {
    const hex = `#${m[1].toLowerCase()}`;
    if (!Object.values(HEX).map((h) => h.toLowerCase()).includes(hex)) adhoc.add(hex);
  }
}
// Reported rather than asserted: the artifact carries a long tail of one-off
// values and failing on all of them would just get the check disabled.
console.log(`  (${adhoc.size} hex values outside the token object — §5.6/§5.7 territory)`);
ok("the stale #4f46e5 indigo is gone", !adhoc.has("#4f46e5"));

console.log(`\n${"─".repeat(52)}\nDESIGN TOKENS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

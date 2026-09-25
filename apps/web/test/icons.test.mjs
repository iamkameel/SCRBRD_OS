/**
 * Icons, and no emoji (DESIGN_DIRECTION §3.4, §3.8).
 *
 * Step 1b took 437 emoji out of the client — out of every control, label, nav
 * item, chip, tile, role identity and heading — and put one icon vocabulary in
 * their place: Lucide, plus twelve cricket glyphs drawn on its grid
 * (ui/icons.jsx). tools/smoke-a11y.mjs counts emoji in the controls of the
 * screens it visits. This suite holds the line everywhere else, statically:
 *
 *   1. NO EMOJI IN apps/web/src outside ALLOW below, each entry with its
 *      reason. A new one fails here, in CI, even on a screen no browser walk
 *      opens. An allow-list entry that no longer matches anything fails too,
 *      so the list cannot outlive what it excuses.
 *   2. EVERY ICON NAME RESOLVES: the role identities, the navigation, and
 *      every literal name written at a call site (`<Icon name="…">`,
 *      `icon="…"`, `icon:"…"`). An unknown name draws nothing, silently.
 *   3. THE GLYPHS SIT ON LUCIDE'S GRID: 24 viewBox, currentColor, round caps
 *      and joins, the shared stroke — and there are the twelve the brief
 *      names, no more and no fewer.
 *   4. THE ACCESSIBLE-NAME RULE: decorative by default (aria-hidden), an image
 *      with a name when labelled, and an icon-only button refuses to render
 *      without a label.
 *   5. THE SHOT KEYS ARE WORDS: the pad's shot catalogue carries no icon.
 *
 *   node --import ./tools/register-jsx.mjs apps/web/test/icons.test.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Icon, IconButton, ICON_NAMES, GLYPH_NAMES, isIcon } from "../src/ui/icons.jsx";
import { ROLE_IDENTITY, NAV_META } from "../src/design/roles.js";
import { SHOT_CATS } from "../src/scorer/shots.js";

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${d}` : ""); } };
const group = (t) => console.log("\n" + t);

const SRC = "apps/web/src";

/**
 * What counts as an emoji. Extended_Pictographic is Unicode's own list of
 * pictographs (it is what emoji are drawn from), plus the regional indicators
 * that pair into flags and the keycap mark that turns "5" into 5️⃣.
 * ©, ® and ™ are Extended_Pictographic too, but they are typography — a
 * copyright line, a captain's (c) — and render as text unless asked not to.
 */
const EMOJI = /(?![©®™])\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3/gu;

/**
 * Emoji allowed to stay, by file, and why. Keep this short and keep the
 * reasons true: an entry here is a promise that none of these reach a
 * control or a label.
 */
const ALLOW = {
  // The international sides' flags are data: engine.jsx hands them to the
  // fold (`flagFor`), which carries them on each innings as `teamFlag`
  // (packages/scoring/src/replay.mjs). No screen draws them since step 1b —
  // the team's name and abbreviation say who it is.
  "scorer/teams.js": "team flags — data carried into the fold, never drawn",
  // The seeded innings mirrors the fold's own default for `teamFlag` (the
  // bat, in replay.mjs), so a seeded match and a replayed one agree. Never drawn.
  "scorer/seed.js": "teamFlag default, mirroring the fold's — never drawn",
};

const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(join(d, e.name)) : /\.(jsx?|mjs|css|html)$/.test(e.name) ? [join(d, e.name)] : []);
const files = walk(SRC);

group("1. No emoji in the client, outside the allow-list");
const found = {};
let total = 0;
for (const f of files) {
  const rel = relative(SRC, f).split("\\").join("/");
  const lines = readFileSync(f, "utf8").split("\n");
  lines.forEach((l, i) => {
    const m = l.match(EMOJI);
    if (m) { (found[rel] ??= []).push(`${rel}:${i + 1} ${m.join("")}`); total += m.length; }
  });
}
const stray = Object.entries(found).filter(([f]) => !ALLOW[f]).flatMap(([, v]) => v);
ok(`no emoji outside the allow-list (${stray.length} line(s) found)`, stray.length === 0, stray.slice(0, 8).join(" · "));
for (const f of Object.keys(ALLOW)) {
  ok(`the allow-list entry for ${f} still excuses something`, !!found[f], "nothing left there — take the entry out");
}
console.log(`  (${total} emoji in ${Object.keys(found).length} allowed file(s))`);

// The detector has to be able to fail, or the zero above means nothing.
ok("the detector sees a pictograph", "🏏 Drive".match(EMOJI)?.length === 1);
ok("...a flag", "🇿🇦".match(EMOJI)?.length === 2);
ok("...a keycap", "5️⃣".match(EMOJI)?.length === 1);
ok("...and not a copyright line, a middle dot or an arrow", !"© 2026 · ›→ ▼ ✓".match(EMOJI));

group("2. Every icon name resolves");
for (const [r, id] of Object.entries(ROLE_IDENTITY)) ok(`role ${r} → "${id.icon}"`, isIcon(id.icon));
for (const [k, m] of Object.entries(NAV_META)) ok(`nav ${k} → "${m.icon}"`, isIcon(m.icon));
// Literal names at call sites. A name built at runtime (`icon={t.icon}`) is
// covered where its table is written as a literal, which is where this looks.
const LITERAL = [/<Icon\b[^>]*?\bname="([^"]+)"/g, /\bicon="([^"]+)"/g, /\bicon:\s*"([^"]+)"/g, /\bicon: "([^"]+)"/g,
                 /<Icon\b[^>]*?\bname=\{[^}]*?\?\s*"([^"]+)"\s*:\s*"([^"]+)"/g, /\?\?\s*"([a-z0-9-]+)"\}\/>/g];
const unknown = [];
let named = 0;
for (const f of files) {
  if (f.endsWith("ui/icons.jsx")) continue;
  const rel = relative(SRC, f);
  const src = readFileSync(f, "utf8");
  for (const re of LITERAL) for (const m of src.matchAll(re)) for (const n of m.slice(1).filter(Boolean)) {
    named++;
    if (!isIcon(n)) unknown.push(`${rel}: "${n}"`);
  }
}
ok(`every literal icon name at a call site resolves (${named} checked)`, unknown.length === 0, unknown.slice(0, 8).join(" · "));
ok("...and the scan finds them (it is not checking nothing)", named > 150, String(named));
ok("an unknown name is not an icon", !isIcon("definitely-not-an-icon") && !isIcon(undefined));

group("3. The twelve glyphs, on Lucide's grid");
const TWELVE = ["bat", "ball", "stumps", "bails-off", "gloves", "pads", "helmet", "overs", "target", "scorebook", "bus", "ground"];
ok("exactly the twelve the brief names", GLYPH_NAMES.length === 12 && TWELVE.every((n) => GLYPH_NAMES.includes(n)), GLYPH_NAMES.join(","));
for (const n of GLYPH_NAMES) {
  const out = renderToStaticMarkup(h(Icon, { name: n }));
  ok(`${n}: a 24px viewBox, currentColor, round caps and joins, stroke 1.75`,
     /viewBox="0 0 24 24"/.test(out) && /stroke="currentColor"/.test(out) && /fill="none"/.test(out)
     && /stroke-linecap="round"/.test(out) && /stroke-linejoin="round"/.test(out) && /stroke-width="1.75"/.test(out), out.slice(0, 200));
  // Nothing drawn outside the 2px margin Lucide keeps: every number in the
  // drawing's geometry sits within 0–24.
  const nums = [...out.matchAll(/\s(?:d|cx|cy|r|rx|ry|x|y|width|height)="([^"]+)"/g)].flatMap((m) => m[1].match(/-?\d*\.?\d+/g) ?? []).map(Number);
  ok(`${n}: drawn inside the grid`, nums.length > 0 && nums.every((v) => v >= -24 && v <= 24));
}
const lucide = renderToStaticMarkup(h(Icon, { name: "calendar" }));
const glyph = renderToStaticMarkup(h(Icon, { name: "bat" }));
const attrs = (s) => s.match(/^<svg([^>]*)>/)[1].replace(/\sclass="[^"]*"/, "").trim();
ok("a glyph's <svg> carries exactly a Lucide icon's attributes", attrs(lucide) === attrs(glyph), `${attrs(lucide)} | ${attrs(glyph)}`);
ok("...and the same class family", /class="lucide lucide-bat"/.test(glyph) && /class="lucide lucide-calendar"/.test(lucide));
ok("where a name is in both sets the glyph is the one drawn (bus, target)",
   /lucide-bus"/.test(renderToStaticMarkup(h(Icon, { name: "bus" }))) && /<rect x="2" y="5"/.test(renderToStaticMarkup(h(Icon, { name: "bus" }))));
ok("an icon is the size of the text it sits in", /width="1em"/.test(lucide) && /height="1em"/.test(lucide));
ok(`the registry holds the glyphs and the Lucide set (${ICON_NAMES.length})`, ICON_NAMES.length > 90 && TWELVE.every((n) => ICON_NAMES.includes(n)));

group("4. The accessible-name rule");
ok("decorative by default: hidden from assistive tech", /aria-hidden="true"/.test(lucide) && !/role="img"/.test(lucide));
const labelled = renderToStaticMarkup(h(Icon, { name: "crown", label: "Top of the table" }));
ok("labelled: an image with that name", /role="img"/.test(labelled) && /aria-label="Top of the table"/.test(labelled) && !/aria-hidden/.test(labelled));
const errors = [];
const real = console.error;
console.error = (...a) => errors.push(a.join(" "));
const btn = renderToStaticMarkup(h(IconButton, { icon: "trash-2", label: "Delete" }));
const bare = renderToStaticMarkup(h(IconButton, { icon: "trash-2" }));
const ghost = renderToStaticMarkup(h(Icon, { name: "definitely-not-an-icon" }));
console.error = real;
ok("an icon-only button takes its name from the label", /<button[^>]*aria-label="Delete"/.test(btn) && /aria-hidden="true"/.test(btn));
ok("...and refuses, loudly, to render without one", errors.some((e) => /no label/.test(e)) && !/aria-label=/.test(bare));
ok("an unknown name draws nothing, and says so", ghost === "" && errors.some((e) => /no icon named/.test(e)));

group("5. The pad's shot keys are words (§3.4)");
const shots = SHOT_CATS.flatMap((c) => c.shots);
ok(`the ${shots.length} shots in the catalogue carry no icon`, shots.length === 22 && shots.every((s) => !("icon" in s) && /^[A-Z]/.test(s.label)));

console.log(`\n${"─".repeat(52)}\nICONS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

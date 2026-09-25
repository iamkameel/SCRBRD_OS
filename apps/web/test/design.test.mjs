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
 *
 * 2.1: there are two themes, Daylight and Floodlit (DESIGN_DIRECTION §3.1),
 * and every contrast rule here is checked IN BOTH — the tokens are switched in
 * place with applyTheme() and measured again. A value that reads under lights
 * and vanishes in the sun is a failure, not a style.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Linter } from "eslint";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../src");

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d ? `— ${d}` : ""); } };
const group = (t) => console.log("\n" + t);

// The tokens are IMPORTED, not scraped out of the source text.
//
// They used to be read with a regex over the file, which worked only while
// every token was a literal hex on its own line. Design System 2.0 splits them
// in two — `T` holds the semantic system and `D` aliases it for the four and a
// half thousand existing call sites — so a scrape now sees `D.textMuted` as
// the string "T.content.tertiary" and silently checks nothing.
//
// Importing is the stronger check anyway: it measures the colour that actually
// reaches the screen rather than the way it happens to be spelled. An alias
// that points at the wrong token is now a contrast failure, which is what it
// really is.
const tokens = await import(join(SRC, "design/tokens.js"));
const { D, T, FLOODLIT, DAYLIGHT, THEMES, applyTheme, themeName, themed, textOn, inkOn } = tokens;
const THEME_NAMES = ["floodlit", "daylight"];
const isHex = (v) => typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);
const hexOf = () => Object.fromEntries(Object.entries(D).filter(([, v]) => isHex(v)));
const lum = (h) => {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const surfaces = () => Object.values(T.surface);
const worst = (c) => Math.min(...surfaces().map((s) => ratio(c, s)));
/** Run `fn` with the tokens switched to each theme in turn. */
const eachTheme = (fn) => { for (const th of THEME_NAMES) { applyTheme(th); fn(th); } applyTheme("floodlit"); };

group("Tokens 2.1 — two complete value sets, and Floodlit is 2.0 unchanged");
// The same keys in both, or a switch leaves the previous theme's value behind
// in whichever key the other set forgot.
const groupsOf = (set) => Object.keys(set).sort().join();
ok("both themes name the same groups", groupsOf(FLOODLIT) === groupsOf(DAYLIGHT), `${groupsOf(FLOODLIT)} / ${groupsOf(DAYLIGHT)}`);
for (const g of Object.keys(FLOODLIT)) {
  const a = Object.keys(FLOODLIT[g]).sort().join(), b = Object.keys(DAYLIGHT[g] ?? {}).sort().join();
  ok(`...and the same keys in ${g}`, a === b, `${a} / ${b}`);
}
ok("the theme names are daylight and floodlit", Object.keys(THEMES).sort().join() === "daylight,floodlit");
// Floodlit IS Design System 2.0: the values as they were on 14 Sep, written
// out here so a change to them is a decision somebody makes in this file.
const TWO_POINT_OH = {
  surface: { canvas: "#05070a", base: "#0a0d13", raised: "#11151d", interactive: "#1a1f29", overlay: "#242a36" },
  content: { primary: "#f4f6f3", secondary: "#a3adbb", tertiary: "#8a94a5" },
  brand: { lime: "#b9f227", green: "#34e58a", cyan: "#2ee6d6", blue: "#3b6ef5", blueText: "#93b4fd" },
  semantic: { positive: "#3ddc84", warning: "#f9b233", critical: "#f4374f", criticalText: "#ff9aa6", info: "#4fc3f7" },
  sport: { batting: "#f7b733", bowling: "#4fd1e8", fielding: "#b48cf5", intelligence: "#b9f227" },
  line: { subtle: "rgba(255,255,255,0.06)", normal: "rgba(255,255,255,0.10)", strong: "rgba(255,255,255,0.18)" },
  elevation: { none: "none", sm: "0 1px 2px rgba(0,0,0,.45)", md: "0 4px 16px rgba(0,0,0,.45)", lg: "0 12px 40px rgba(0,0,0,.55)", xl: "0 24px 72px rgba(0,0,0,.65)" },
  glass: { film: "rgba(10,13,19,0.72)", blur: "blur(22px) saturate(1.5)", edge: "rgba(255,255,255,0.10)" },
};
const drift = Object.entries(TWO_POINT_OH).flatMap(([g, vals]) =>
  Object.entries(vals).filter(([k, v]) => FLOODLIT[g][k] !== v).map(([k, v]) => `${g}.${k} ${FLOODLIT[g][k]} ≠ ${v}`));
ok("every 2.0 value is in Floodlit, unchanged", drift.length === 0, drift.join(", "));
ok("...and the 2.0 light and violetText values too",
   FLOODLIT.light.cobalt === "linear-gradient(135deg,#3b6ef5,#2ee6d6)" && FLOODLIT.sport.fieldingText === "#cdb4fb");

group("The switch is in place, and complete");
// Tokens stay hex strings and are rewritten on the same objects (tokens.js
// says why). So the objects must not change identity, and every themed value
// must be the theme's own after a switch.
const tBefore = T.surface, dBefore = D;
eachTheme((th) => {
  const set = THEMES[th];
  const off = Object.keys(set).flatMap((g) => Object.keys(set[g]).filter((k) => T[g][k] !== set[g][k]).map((k) => `${g}.${k}`));
  ok(`${th}: every themed token holds the ${th} value`, off.length === 0, off.join(", "));
  ok(`${th}: themeName() says so`, themeName() === th);
  ok(`${th}: D is re-pointed with it`, D.surf1 === T.surface.raised && D.textMuted === T.content.tertiary && D.lime === T.brand.lime);
  ok(`${th}: GLOBAL_CSS is rebuilt for it`, tokens.GLOBAL_CSS.includes(`body{background:${T.surface.canvas}`));
});
ok("T and D are the same objects after switching", T.surface === tBefore && D === dBefore);
{
  // themed(): a module-level table that reads the live value.
  const TONE = themed(() => ({ ok: D.emerald }));
  const LIST = themed(() => [{ c: D.amber }], []);
  applyTheme("daylight");
  const day = [TONE.ok, LIST.map((x) => x.c)[0], Array.isArray(LIST)];
  applyTheme("floodlit");
  ok("themed() follows the theme, as a table and as a list",
     day[0] === DAYLIGHT.semantic.positive && day[1] === DAYLIGHT.semantic.warning && day[2] === true
       && TONE.ok === FLOODLIT.semantic.positive, JSON.stringify(day));
}

group("The board is always black");
// Decision 6: the scoreboard is black in both themes, everywhere.
const boardIn = {};
eachTheme((th) => { boardIn[th] = JSON.stringify(T.board); });
ok("the board tokens do not switch", boardIn.floodlit === boardIn.daylight);
ok("the face is black", lum(T.board.face) < 0.01, T.board.face);
for (const k of ["figure", "lime", "dim"])
  ok(`board.${k} reads on the face at ${ratio(T.board[k], T.board.face).toFixed(2)}:1`, ratio(T.board[k], T.board.face) >= 4.5);
ok("the board uses the §3.1 values", T.board.face === "#0b0e0b" && T.board.figure === "#f4f6f3" && T.board.lime === "#b9f227"
   && T.board.dim === "#8a94a5" && T.board.rule === "rgba(255,255,255,0.14)");

group("Type roles and the flip (§3.2, §3.6)");
const R = T.role;
const px_ = (s) => parseFloat(s);
ok("four figure roles, all DM Mono and tabular",
   ["board", "lg", "md", "sm"].every((k) => /DM Mono/.test(R.figure[k].fontFamily) && R.figure[k].fontVariantNumeric === "tabular-nums"));
ok("figure sizes are 56 / 32 / 20 / 14, the board 72 on a tablet",
   [["board", 56], ["lg", 32], ["md", 20], ["sm", 14]].every(([k, n]) => px_(R.figure[k].fontSize) === n)
   && px_(R.wide.figureBoard.fontSize) === 72 && R.wide.figureBoard.minWidth === "768px");
ok("titles: Syne 24 for a screen, Sans 18 for a card",
   /Syne/.test(R.title.lg.fontFamily) && px_(R.title.lg.fontSize) === 24 && /DM Sans/.test(R.title.md.fontFamily) && px_(R.title.md.fontSize) === 18);
ok("body 15 (14 on a desktop), label 12 uppercase +0.06em, control 16",
   px_(R.body.fontSize) === 15 && px_(R.wide.body.fontSize) === 14 && px_(R.label.fontSize) === 12
   && R.label.textTransform === "uppercase" && R.label.letterSpacing === "0.06em" && px_(R.control.fontSize) === 16);
ok("the faces are the three that stay: Mono for figures, Sans to read, Syne for titles",
   [R.body, R.label, R.control, R.title.md].every((r) => /DM Sans/.test(r.fontFamily)) && /Syne/.test(R.title.lg.fontFamily));
const ROLE_STYLES = [...Object.values(R.figure), ...Object.values(R.title), R.body, R.label, R.control];
ok("each role is plain CSS, safe to spread into a style",
   ROLE_STYLES.every((r) => Object.keys(r).every((k) => /^(fontFamily|fontSize|lineHeight|fontWeight|fontVariantNumeric|letterSpacing|textTransform)$/.test(k))));
ok("nothing read is below the 12px floor", ROLE_STYLES.every((r) => px_(r.fontSize) >= T.floor.read)
   && T.floor.read === 12 && T.floor.tap === 16 && T.floor.target === 44);
ok("the flip is 190ms, swift", T.motion.flip === "190ms" && T.motion.swift === "cubic-bezier(.4,0,.2,1)");
ok("...and GLOBAL_CSS draws it with those two, where reduced motion can cut it",
   new RegExp(`\\.os-board-flip\\{[^}]*animation:boardFlip ${T.motion.flip} ${T.motion.swift.replace(/[().,]/g, "\\$&")}`).test(tokens.GLOBAL_CSS)
   && /prefers-reduced-motion: reduce\)\{\s*\*,\*::before,\*::after\{\s*animation-duration:1ms!important/.test(tokens.GLOBAL_CSS));

eachTheme((th) => {
  group(`${th === "daylight" ? "Daylight" : "Floodlit"} — the semantic system holds its own contrast`);
  // Every value named for a job rather than a hue, measured against all five
  // surfaces. The fill-only ones are declared and must each have a readable
  // half; everything else in these four groups must read on its own.
  const S = surfaces();
  if (th === "floodlit")
    ok("five surfaces, darkest to lightest", S.length === 5 && S.every((s, i, a) => i === 0 || lum(s) > lum(a[i - 1])));
  else
    ok("five surfaces: the page, lighter resting and raised ones, a darker hover",
       S.length === 5 && lum(T.surface.base) > lum(T.surface.canvas) && lum(T.surface.raised) >= lum(T.surface.base)
       && lum(T.surface.interactive) < lum(T.surface.canvas) && T.surface.overlay === T.surface.raised);
  const FILL_ONLY = th === "floodlit"
    ? { "brand.blue": "brand.blueText", "semantic.critical": "semantic.criticalText" }
    : { "brand.blue": "brand.blueText", "brand.lime": "brand.accentText" };
  for (const g of ["content", "brand", "semantic", "sport"]) {
    for (const [k, v] of Object.entries(T[g])) {
      const name = `${g}.${k}`;
      if (FILL_ONLY[name]) continue;
      ok(`${name} ${v} reads at ${worst(v).toFixed(2)}:1`, isHex(v) && worst(v) >= 4.5);
    }
  }

  group(`${th === "daylight" ? "Daylight" : "Floodlit"} — the fill-only values are declared, and paired`);
  // A colour that cannot be read is not a bug as long as it is never read. The
  // pairing is what makes that true, and textOn() is how a call site honours it
  // without knowing which value it was handed.
  const at = (name) => name.split(".").reduce((o, k) => o[k], T);
  for (const [fill, pair] of Object.entries(FILL_ONLY)) {
    ok(`${fill} ${at(fill)} has its readable half ${pair} ${at(pair)} at ${worst(at(pair)).toFixed(2)}:1`, worst(at(pair)) >= 4.5);
    ok(`...and textOn(${fill}) returns that half, not the fill`, textOn(at(fill)) === at(pair));
  }
  ok("a fill that does not read is declared fill-only",
     ["brand.lime", "brand.blue", "semantic.critical"].every((n) => worst(at(n)) >= 4.5 || FILL_ONLY[n]));
  ok("textOn leaves a colour that is already readable alone", textOn(T.semantic.positive) === T.semantic.positive);
  // A data colour that is not a token — a team's kit — is made legible.
  for (const kit of ["#003580", "#f4c430", "#000000"])
    ok(`textOn(${kit}), a kit colour, reads at ${worst(textOn(kit)).toFixed(2)}:1`, worst(textOn(kit)) >= 4.5);

  group(`${th === "daylight" ? "Daylight" : "Floodlit"} — text sitting ON a fill is measured against that fill`);
  // The surfaces are not the only background in the app. A count badge puts type
  // directly on an accent, and the unread badge did it in white on the critical
  // red — 3.81:1, a fail, on the one element in the chrome whose whole job is to
  // be read at a glance. Near-black on the same red is 5.29:1.
  //
  // The rule generalises: whatever a badge is filled with, the text on it must
  // clear AA against THAT, not against the page. inkOn() picks the ink.
  for (const [what, fill] of [
    ["unread alerts", T.semantic.critical], ["live chip", T.brand.green], ["warning chip", T.semantic.warning],
    ["lime key", T.brand.lime], ["four", D.indigo], ["six / no-ball", D.amber], ["wide", D.orange],
    ["penalty", D.violet], ["run", D.emerald], ["info", D.sky], ["cyan", D.cyan],
  ]) ok(`the ${what} fill ${fill} takes ink at ${ratio(inkOn(fill), fill).toFixed(2)}:1`, ratio(inkOn(fill), fill) >= 4.5);
  if (th === "floodlit")
    // Stated as the trap it is, so the next person does not reach for white.
    for (const fill of [T.semantic.critical, T.brand.green, T.semantic.warning])
      ok(`...and white on ${fill} would not have (${ratio("#ffffff", fill).toFixed(2)}:1)`, ratio("#ffffff", fill) < 4.5);
  if (th === "daylight") {
    // The gradients carry white type (buttons, the active tab). In daylight
    // every stop is deep enough for it; under lights they are the 2.0 values.
    const stops = Object.entries(T.light).filter(([k]) => k !== "ambient" && k !== "ink")
      .flatMap(([k, v]) => (v.match(/#[0-9a-fA-F]{6}/g) ?? []).map((h) => [k, h]));
    const weak = stops.filter(([, h]) => ratio(T.light.ink, h) < 4.5);
    ok(`white reads on every daylight gradient stop (${stops.length})`, weak.length === 0, weak.map(([k, h]) => `${k} ${h}`).join(", "));
    ok("the lime fill takes the primary ink, as §3.1 says", inkOn(T.brand.lime) === T.content.primary);
  }

  group(`${th === "daylight" ? "Daylight" : "Floodlit"} — D is an alias table, not a second palette`);
  // The one rule that keeps two token surfaces from becoming two design systems:
  // everything D exposes must be a value T already declares. A hex that appears
  // only in D is a colour nobody chose semantically.
  const tValues = new Set(Object.values(T).flatMap((v) => (typeof v === "object" ? Object.values(v) : [v])));
  const orphans = Object.entries(D).filter(([, v]) => isHex(v) && !tValues.has(v)).map(([k, v]) => `${k} ${v}`);
  // violetText used to be the one exception; 2.1 gives it a home in T
  // (sport.fieldingText), because it needs a daylight value too.
  ok("every D colour is a T colour", orphans.length === 0, orphans.join(", "));

  group(`${th === "daylight" ? "Daylight" : "Floodlit"} — every token used as text clears AA on every surface`);
  // 4.5:1 is the threshold for body text. Large display type would allow 3:1,
  // but these tokens are used at 10-13px far more often than they are used big.
  const HEX = hexOf();
  for (const t of ["textPrimary", "textSecondary", "textMuted", "indigoText", "violetText", "roseText", "sky", "emerald", "amber", "orange", "violet", "cyan", "teal"]) {
    if (!HEX[t]) { ok(`${t} exists`, false); continue; }
    ok(`${t} reads at ${worst(HEX[t]).toFixed(2)}:1`, worst(HEX[t]) >= 4.5);
  }

  group(`${th === "daylight" ? "Daylight" : "Floodlit"} — the fill/text pairing is real, not cosmetic`);
  for (const [fill, text] of [["indigo", "indigoText"], ["violet", "violetText"], ["rose", "roseText"]]) {
    ok(`${text} exists as the readable half of ${fill}`, !!HEX[text]);
    // "Readable half" means MORE contrast on the surfaces than the fill has:
    // lighter under lights, darker (or the same, where the fill already
    // reads) in daylight.
    ok(`...and reads at least as well as ${fill} (${worst(HEX[text]).toFixed(2)} ≥ ${worst(HEX[fill]).toFixed(2)})`,
       HEX[text] && worst(HEX[text]) >= worst(HEX[fill]));
  }
});

group("The theme engine and the page agree before React runs");
// index.html makes the first decision (no flash of the wrong theme); the
// engine reads the same key and the page's colours are the tokens' canvases.
const html = readFileSync(join(SRC, "../index.html"), "utf8");
const engine = readFileSync(join(SRC, "design/theme.js"), "utf8");
const key = engine.match(/THEME_KEY = "([^"]+)"/)?.[1];
ok(`the engine stores the choice under one key (${key})`, !!key);
ok("...and the boot script reads the same key", !!key && html.includes(`localStorage.getItem("${key}")`));
ok("the boot script paints Floodlit's canvas and Daylight's",
   html.includes(`"${FLOODLIT.surface.canvas}"`) && html.includes(`"${DAYLIGHT.surface.canvas}"`));
ok("...follows prefers-color-scheme when nothing is stored", /matchMedia\("\(prefers-color-scheme: light\)"\)/.test(html));
ok("...and sets the browser theme-color", /meta\[name="theme-color"\]/.test(html) && /name="theme-color"/.test(html));
ok("the storage read is guarded", /try\s*\{[^}]*localStorage\.getItem/.test(html));
ok("the engine listens for the system setting changing", /addEventListener\("change"/.test(engine) && /prefers-color-scheme: light/.test(engine));
{
  // Code only: the file's comments talk about localStorage too.
  const code = engine.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const uses = (code.match(/localStorage/g) ?? []).length;
  const guarded = (code.match(/try\s*\{[^}]*\}/g) ?? []).reduce((n, m) => n + (m.match(/localStorage/g) ?? []).length, 0);
  ok(`...and guards every storage read and write (${guarded} of ${uses})`, uses > 0 && uses === guarded);
}
{
  // The engine itself, in Node: no window, no storage, so System → Floodlit.
  const theme = await import(join(SRC, "design/theme.js"));
  ok("with nothing stored and no device setting, the preference is System", theme.readPreference() === "system");
  ok("...which resolves to Floodlit", theme.resolveTheme("system") === "floodlit");
  ok("an override resolves to itself", theme.resolveTheme("daylight") === "daylight" && theme.resolveTheme("floodlit") === "floodlit");
  ok("the three choices are System, Daylight, Floodlit",
     theme.THEME_CHOICES.map((c) => c.label).join() === "System,Daylight,Floodlit");
  theme.setPreference("daylight");
  ok("setting Daylight switches the tokens", themeName() === "daylight" && T.surface.canvas === DAYLIGHT.surface.canvas);
  theme.setPreference("system");
  ok("...and System switches them back", themeName() === "floodlit" && theme.getPreference() === "system");
}

const files = [];
(function walk(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.jsx?$/.test(e.name)) files.push(p);
  }
})(SRC);

group("Nothing copies a token at import time");
// The tokens switch in place (tokens.js says why). A module-level constant
// built from them — `const TONE = { ok: D.emerald }` — copies the VALUE when
// the module loads and keeps it: the first theme's colour, forever, on
// whichever screen reads it, and nothing throws. Lazy views make it worse:
// they load in whichever theme is current when first opened. So no token may
// be read outside a function body, except through themed(), whose argument
// is itself a function. Parsed, not grepped: the question is scope.
const importTimeRule = {
  meta: { type: "problem", schema: [] },
  create(context) {
    const names = new Set();
    return {
      ImportDeclaration(node) {
        if (/(^|\/)tokens\.js$/.test(node.source.value)) for (const s of node.specifiers) names.add(s.local.name);
      },
      MemberExpression(node) {
        if (node.object.type !== "Identifier" || !names.has(node.object.name)) return;
        const up = context.sourceCode.getAncestors(node);
        if (up.some((a) => /Function/.test(a.type))) return;
        context.report({ node, message: `${node.object.name}.${node.property.name ?? "?"} read at import time` });
      },
    };
  },
};
const linter = new Linter();
const lintConfig = [{
  files: ["**/*.js", "**/*.jsx"],
  languageOptions: { ecmaVersion: "latest", sourceType: "module", parserOptions: { ecmaFeatures: { jsx: true } } },
  plugins: { design: { rules: { "no-import-time-tokens": importTimeRule } } },
  rules: { "design/no-import-time-tokens": "error" },
}];
const frozen = [];
for (const f of files) {
  if (/design\/(tokens|theme)\.js$/.test(f)) continue;   // the engine itself
  const rel = f.replace(SRC, "src");
  // This rule's reports, and a file that does not parse (which would
  // otherwise pass by being unreadable). The files' own eslint-disable
  // comments name rules this linter does not load; those notes are not ours.
  for (const m of linter.verify(readFileSync(f, "utf8"), lintConfig, { filename: rel }))
    if (m.fatal || m.ruleId === "design/no-import-time-tokens") frozen.push(`${rel}:${m.line} ${m.message}`);
}
ok(`no module reads a token at import time (${files.length} files)`, frozen.length === 0, frozen.slice(0, 5).join(" · "));
// The rule has to be able to fail, or a green here means nothing.
const probe = linter.verify('import { D } from "../design/tokens.js";\nconst TONE = { ok: D.emerald };\nconst F = () => D.emerald;',
  lintConfig, { filename: "probe.js" });
ok("...and the check catches one (falsified)", probe.length === 1 && probe[0].line === 2);

group("Role colours are theme colours");
{
  const { ROLE_IDENTITY: RI, ROLES: RO } = await import(join(SRC, "design/roles.js"));
  const seen = {};
  eachTheme((th) => { seen[th] = [RI.coach.color, RO.coach.color]; });
  ok("a role's colour answers for the theme in force", seen.floodlit[0] !== seen.daylight[0]);
  ok("...through ROLES as well as ROLE_IDENTITY — a spread would have frozen it",
     seen.floodlit[0] === seen.floodlit[1] && seen.daylight[0] === seen.daylight[1]);
}

group("No accent is used as running text");
// The pairing only helps if the code honours it. `color:D.indigo` is the
// failure this catches: same brand, unreadable at 11px on a card. Lime is on
// the list since 2.1: it reads under lights and is a fill in daylight (1.1:1
// on the page), so as text it goes through textOn() like the others.
let raw = [];
for (const f of files) {
  const src = readFileSync(f, "utf8");
  // `color:` with optional spaces, and optionally through a ternary — the
  // spelling `color: error ? D.rose : D.textMuted` shipped a fill-only red as
  // an error message for as long as this pattern only matched the tight form.
  for (const m of src.matchAll(/(?<![A-Za-z])color:\s*(?:[^,;{}\n]*\?\s*)?D\.(indigo|violet|rose|lime)\b(?!Text)/g)) {
    // A colour that is DATA — a shot category, a role identity — is declared
    // with the fill value and passed through textOn() where it becomes text.
    // That is the pairing working, not a violation of it.
    if (/\bcat:|\brole:|^\s*(label|id):/m.test(src.slice(Math.max(0, m.index - 120), m.index))) continue;
    raw.push(`${f.replace(SRC, "src")}: ${m[0]}`);
  }
}
// The tight spelling — `color:D.rose` — must be zero, and always has been.
const tight = raw.filter((r) => /color:D\./.test(r));
ok("no fill-only accent is set as a text colour", tight.length === 0, tight.slice(0, 3).join(" · "));

// The loose spelling — `color: cond ? D.rose : …` — is the same bug wearing a
// ternary, and widening the pattern to catch it found a tail of thirty-odd
// pre-existing sites. They are NOT all the same fix: some are a colour being
// READ, which textOn() resolves at the point of use, and some are a colour
// being DECLARED as data, where wrapping it at the declaration would wrongly
// lighten the fill as well. Telling those apart is a per-file judgement.
//
// So this is a ratchet rather than a threshold. The number may go DOWN and
// must never go up: a new one is a new bug, and paying the tail down is module
// work that belongs with the screens, not with the tokens.
const LOOSE_TAIL = 29;
ok(`the ternary tail is ${raw.length - tight.length} and not growing (ratchet: ${LOOSE_TAIL})`,
   raw.length - tight.length <= LOOSE_TAIL,
   raw.filter((r) => !/color:D\./.test(r)).slice(0, 3).join(" · "));

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

group("Role identity");
// §5.3 found six colliding pairs across seventeen roles, every collision
// between an original role and one added in a merge — the new ones were given
// recycled colours. Super Admin and Headmaster were identical while having
// materially different access to clinical records.
//
// Worse than the collisions: the UI named seventeen roles the authorization
// model had never heard of, while fourteen roles that DO carry permissions had
// no identity at all. Signing in as a director of sport gave ROLES[undefined]
// and an empty shell.
const { ROLE_IDENTITY, ROLES, ROLE_FAMILIES, NAV_CAPABILITY, NAV_GROUPS, NAV_GROUP, NAV_ORDER, canonicalRole, groupNav, navForRoles } = await import(join(SRC, "design/roles.js"));
const { ROLES: POLICY_ROLES, roleGrants } = await import("@scrbrd/policy/roles");

ok("every policy role has a visual identity",
   POLICY_ROLES.every((r) => !!ROLE_IDENTITY[r]),
   POLICY_ROLES.filter((r) => !ROLE_IDENTITY[r]).join(", "));
ok("...and every identity is a real policy role",
   Object.keys(ROLE_IDENTITY).every((r) => POLICY_ROLES.includes(r)),
   Object.keys(ROLE_IDENTITY).filter((r) => !POLICY_ROLES.includes(r)).join(", "));
ok("every role gets a navigation", POLICY_ROLES.every((r) => ROLES[r]?.nav?.length > 0));

// Distinct is not the same as distinguishable: two colours can differ in hex,
// pass contrast, and still be the same colour to a person. dE76 over CIELAB is
// the check that means something.
const lab = (h) => {
  let [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(X), f(Y), f(Z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
};
const dE = (a, b) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));
ok("every role declares a family", Object.values(ROLE_IDENTITY).every((id) => !!id.family));
const sameFamily = (a, b) => ROLE_IDENTITY[a].family === ROLE_IDENTITY[b].family;

// Each role has a colour per theme (roles.js: the table is Floodlit's,
// ROLE_DAYLIGHT the sun's), and every rule below holds in both.
eachTheme((th) => {
  const colours = Object.entries(ROLE_IDENTITY).map(([r, id]) => [r, id.color.toLowerCase()]);
  const dupes = colours.filter(([, c], i) => colours.findIndex(([, d]) => d === c) !== i);
  ok(`${th}: no two roles share a colour`, dupes.length === 0, dupes.map(([r]) => r).join(", "));

  // Role colour is used as TEXT, so 4.5:1 is the bar, on every surface.
  const dim = colours.filter(([, c]) => worst(c) < 4.5);
  ok(`${th}: every role colour is readable on every surface`, dim.length === 0,
     dim.map(([r, c]) => `${r} ${worst(c).toFixed(2)}:1`).join(", "));

  let closest = [Infinity, "", ""];
  for (let i = 0; i < colours.length; i++)
    for (let j = i + 1; j < colours.length; j++) {
      const d = dE(colours[i][1], colours[j][1]);
      if (d < closest[0]) closest = [d, colours[i][0], colours[j][0]];
    }
  ok(`${th}: the closest pair is ${closest[0].toFixed(1)} apart (${closest[1]}/${closest[2]})`, closest[0] >= 8);

  // Family is the other half of the signal: it says which domain of access a
  // role sits in, so a colour carries meaning in two dimensions rather than one.
  ok(`${th}: the closest pair is within one family or across adjacent ones`,
     sameFamily(closest[1], closest[2]) ||
     ["platform", "governance"].every((f) => [ROLE_IDENTITY[closest[1]].family, ROLE_IDENTITY[closest[2]].family].includes(f)));
});

// The bug this whole file exists to fix, stated as a property: the live login
// picks the widest assignment a person holds and looks it up here. Sarah is a
// director of sport at one school and a guardian at another; `directorofsport`
// was a role the UI had never heard of, so signing in as her produced
// ROLES[undefined] — a working session with no navigation and no name.
for (const r of ["directorofsport", "principal", "teammanager", "official", "media", "scout"]) {
  ok(`a ${r} can be signed in and shown something`,
     !!ROLES[r]?.label && ROLES[r].nav.length > 0);
}

group("The role switcher offers each role once");
// Reported from the live deployment: the menu listed "Platform Admin" three
// times and "Principal" twice, among six more duplicated pairs.
//
// The cause was that ROLES used to be a LOOKUP table — the twenty-four real
// roles plus nine demonstration aliases (superadmin, headmaster, parent…)
// that resolved to them. An alias carried its target's own label, so
// iterating ROLES to build a menu rendered the same role several times under
// the same name, and picking between the copies was meaningless.
//
// SCRBRD-027 retired the alias table (rbac/legacy-roles.js) once nothing in
// the client — login, onboarding, or the switcher — still spoke the old
// vocabulary. ROLES is now exactly ROLE_IDENTITY: one entry per policy role,
// nothing to alias.
//
// ROLE_FAMILIES is the canonical set, grouped. It is what a chooser must use.
const familyMembers = Object.values(ROLE_FAMILIES).flat();
ok("the families cover every policy role", POLICY_ROLES.every((r) => familyMembers.includes(r)),
   POLICY_ROLES.filter((r) => !familyMembers.includes(r)).join(", "));
ok("...each exactly once",
   familyMembers.length === POLICY_ROLES.length && new Set(familyMembers).size === familyMembers.length);
ok("...and name no alias", familyMembers.every((r) => POLICY_ROLES.includes(r)));

const familyLabels = familyMembers.map((r) => ROLES[r].label);
const dupLabels = familyLabels.filter((l, i) => familyLabels.indexOf(l) !== i);
ok("no two offered roles share a name", dupLabels.length === 0, [...new Set(dupLabels)].join(", "));

// The alias table is gone (SCRBRD-027): ROLES is no longer a lookup table
// wider than the offered set, it IS the offered set. Iterating it can never
// render a duplicate again, because there is nothing left to duplicate.
ok("the lookup table carries no alias — it is exactly the offered set",
   Object.keys(ROLES).length === familyMembers.length);

group("Every sign-in and onboarding entry point speaks only policy roles");
// The client used to carry a second vocabulary — superadmin, headmaster,
// sportsmaster, parent, assistant… — mapped onto these through
// rbac/legacy-roles.js. That file is gone, so a role name reaching
// principalForRole()/canonicalRole()/ROLES[] from a login screen, a demo
// account or the onboarding persona picker is no longer translated. It must
// already be one of ROLE_IDENTITY's own keys, or the account signs in to a
// blank shell (ROLES[undefined]) and default-deny.
//
// Scraped from source rather than imported, because these are literal
// object keys inside component functions, not exported constants — the same
// technique the roles-screen check below uses for SettingsView.
const loginSrc = readFileSync(join(SRC, "auth/LoginPage.jsx"), "utf8");
const onboardingSrc = readFileSync(join(SRC, "auth/OnboardingFlow.jsx"), "utf8");
const entryPointRoles = new Set([
  ...[...loginSrc.matchAll(/\brole:\s*"([a-z]+)"/g)].map((m) => m[1]),
  ...[...onboardingSrc.matchAll(/\{\s*id:"([a-z]+)",\s*icon:/g)].map((m) => m[1]),
]);
ok(`found sign-in/onboarding roles to check (${entryPointRoles.size})`, entryPointRoles.size > 0);
for (const r of entryPointRoles)
  ok(`"${r}" (login or onboarding) is a real policy role, not a legacy name`,
     POLICY_ROLES.includes(r));
// The function that used to translate a legacy name now has nothing to
// translate: every policy role must resolve to itself.
ok("canonicalRole is the identity function on every policy role",
   POLICY_ROLES.every((r) => canonicalRole(r) === r));

group("The roles screen describes every role, from the policy");
// It rendered thirty-three cards — the lookup table, aliases and all — against
// a hand-written table of ten descriptions. Twenty-three had no detail at all,
// the director of sport and the principal among them, and three of the ten
// were written against demonstration aliases so the real roles behind them
// showed nothing.
//
// A hand-written permission list is a second place for authority to live, on
// the one screen whose subject IS authority. The check is therefore that the
// description is DERIVABLE: every policy role must have capabilities to show,
// and every capability must fall in a domain the screen can name.
const settingsSrc = readFileSync(join(SRC, "views/SettingsView.jsx"), "utf8");
ok("the roles screen no longer carries a hand-written permission table",
   !/const PERMS = \{/.test(settingsSrc));
ok("...and iterates the families rather than the lookup table",
   /ROLE_FAMILIES\)\.map/.test(settingsSrc) && !/Object\.entries\(ROLES\)\.map/.test(settingsSrc));

const { ROLE_CAPABILITIES } = await import("@scrbrd/policy/roles");
const domainsFor = (r) => [...new Set([...(ROLE_CAPABILITIES[r] ?? [])].map((c) => c.split(".")[0]))];
const undescribed = POLICY_ROLES.filter((r) => domainsFor(r).length === 0);
ok("every policy role has something to describe", undescribed.length === 0, undescribed.join(", "));

// The label table is presentation, so a missing entry degrades to the raw
// prefix rather than blanking — but a gap is still worth naming here, because
// "platform" reading as "platform" is fine and a new domain reading as a bare
// code is how a screen starts looking unfinished.
const labelled = new Set(Object.keys(
  // Whitespace after the colon is a formatting choice, not a missing label.
  Object.fromEntries((settingsSrc.match(/(\w+):\s*"[^"]+"/g) ?? []).map((m) => m.split(/:\s*/)))));
const allDomains = [...new Set(POLICY_ROLES.flatMap(domainsFor))];
const unlabelled = allDomains.filter((d) => !labelled.has(d));
ok(`every capability domain has a readable name (${allDomains.length} domains)`,
   unlabelled.length === 0, unlabelled.join(", "));

group("Navigation is derived, not hand-listed");
// A hand-written nav per role is a second place for authority to live, and a
// second place for it to drift: a role gains a capability and never gains the
// entry, or keeps the entry long after the capability goes. Both had happened.
ok("every destination names the capability that governs it",
   Object.entries(NAV_CAPABILITY).every(([, cap]) => cap === null || typeof cap === "string"));
// A persona is its role plus the roles it always comes with (`also`): the
// pupil is player AND selfaccess. The menu may reach what any of them holds.
const heldBy = (r) => [r, ...(ROLE_IDENTITY[r]?.also ?? [])];
ok("a role only sees what its capabilities reach",
   POLICY_ROLES.every((r) => ROLES[r].nav.every((d) =>
     NAV_CAPABILITY[d] === null || heldBy(r).some((h) => roleGrants(h, NAV_CAPABILITY[d])))));
ok("...and `also` names only real policy roles",
   Object.values(ROLE_IDENTITY).every((id) => (id.also ?? []).every((r) => POLICY_ROLES.includes(r))));
// The team role does not read a team-mate's ratings; the boy's own screens
// come through self-access, and the persona still shows them.
ok("the player role holds no development read across the side", !roleGrants("player", "player.development.read"));
ok("...so on its own it is not offered the skills screen", !navForRoles(["player"]).includes("skills"));
ok("...and with self-access it is", navForRoles(["player", "selfaccess"]).includes("skills") && ROLES.player.nav.includes("skills"));
ok("a coach who is also a parent gets both menus",
   navForRoles(["coach", "guardian"]).includes("skills") && navForRoles(["guardian"]).length < navForRoles(["coach", "guardian"]).length);
// The concrete case: a scorer holds no medical capability and must not be
// offered the injuries screen, whatever a hand-written list once said.
ok("a scorer is not offered injuries", !ROLES.scorer.nav.includes("injuries"));
ok("a physio is", ROLES.medical.nav.includes("injuries"));
ok("a driver sees logistics and little else",
   ROLES.driver.nav.includes("logistics") && ROLES.driver.nav.length <= 6);

group("Navigation is grouped, and the grouping adds nothing");
// One ordered structure. The capability map says what a destination NEEDS;
// the groups say where it is DRAWN. Every destination must be in exactly one
// group, or a role could hold the capability and find no menu entry — the
// hand-listed drift this file already refuses, back through a side door.
const grouped = NAV_GROUPS.flatMap((g) => g.items);
ok("every destination is in exactly one group",
   Object.keys(NAV_CAPABILITY).every((k) => grouped.filter((g) => g === k).length === 1),
   Object.keys(NAV_CAPABILITY).filter((k) => grouped.filter((g) => g === k).length !== 1).join(", "));
ok("...and no group names a destination the capability map lacks",
   grouped.every((k) => k in NAV_CAPABILITY), grouped.filter((k) => !(k in NAV_CAPABILITY)).join(", "));
ok("the flat order is the grouped order", NAV_ORDER.join() === grouped.join());
ok("every group has a key and a label",
   NAV_GROUPS.every((g) => /^[a-z]+$/.test(g.key) && g.label.length > 1));
ok("group keys are distinct", new Set(NAV_GROUPS.map((g) => g.key)).size === NAV_GROUPS.length);
ok("the dashboard is first and the person's own screens are last",
   NAV_ORDER[0] === "dashboard" && NAV_GROUPS.at(-1).key === "you" && NAV_GROUP.settings === "you");
// The property that matters: grouping a role's nav yields the same set of
// destinations, in the same relative order, with no empty headings.
for (const r of POLICY_ROLES) {
  const gs = groupNav(ROLES[r].nav);
  const flat = gs.flatMap((g) => g.items);
  ok(`grouping the ${r} nav loses nothing and adds nothing`,
     flat.length === ROLES[r].nav.length && flat.every((k) => ROLES[r].nav.includes(k)));
  ok(`...draws no empty group for the ${r}`, gs.every((g) => g.items.length > 0));
}
ok("a stranger's key is dropped, not drawn",
   groupNav(["dashboard", "not-a-screen"]).flatMap((g) => g.items).join() === "dashboard");
ok("a driver gets three sections, not a wall",
   groupNav(ROLES.driver.nav).map((g) => g.key).join() === "play,operate,you");

group("The palette is closed");
// A fixed palette only works if nothing invents a thirteenth accent.
const adhoc = new Set();
const HEX_ALL = new Set();
eachTheme(() => { for (const h of Object.values(hexOf())) HEX_ALL.add(h.toLowerCase()); });
// Comments are stripped first: a hex named in a note ABOUT a colour — "the
// off-palette #22d3ee is gone" — is documentation, not a use of it, and
// counting it would make the check unable to describe its own history.
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
for (const f of files) {
  for (const m of stripComments(readFileSync(f, "utf8")).matchAll(/#([0-9a-fA-F]{6})\b/g)) {
    const hex = `#${m[1].toLowerCase()}`;
    if (!HEX_ALL.has(hex)) adhoc.add(hex);
  }
}
// Reported rather than asserted: the artifact carries a long tail of one-off
// values and failing on all of them would just get the check disabled.
console.log(`  (${adhoc.size} hex values outside the token object — §5.6/§5.7 territory)`);
ok("the stale #4f46e5 indigo is gone", !adhoc.has("#4f46e5"));
// The off-palette accent the audit called out by name: a twelfth hue
// introduced ad-hoc for Coaching Assistant, which is the exact failure the
// fixed-palette rule exists to prevent.
ok("the off-palette #22d3ee is gone", !adhoc.has("#22d3ee"));

console.log(`\n${"─".repeat(52)}\nDESIGN TOKENS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

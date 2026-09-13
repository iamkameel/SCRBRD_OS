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
const { ROLE_IDENTITY, ROLES, NAV_CAPABILITY, NAV_GROUPS, NAV_GROUP, NAV_ORDER, groupNav, navForRoles } = await import(join(SRC, "design/roles.js"));
const { ROLES: POLICY_ROLES, roleGrants } = await import("@scrbrd/policy/roles");

ok("every policy role has a visual identity",
   POLICY_ROLES.every((r) => !!ROLE_IDENTITY[r]),
   POLICY_ROLES.filter((r) => !ROLE_IDENTITY[r]).join(", "));
ok("...and every identity is a real policy role",
   Object.keys(ROLE_IDENTITY).every((r) => POLICY_ROLES.includes(r)),
   Object.keys(ROLE_IDENTITY).filter((r) => !POLICY_ROLES.includes(r)).join(", "));
ok("every role gets a navigation", POLICY_ROLES.every((r) => ROLES[r]?.nav?.length > 0));

const colours = Object.entries(ROLE_IDENTITY).map(([r, id]) => [r, id.color.toLowerCase()]);
const dupes = colours.filter(([, c], i) => colours.findIndex(([, d]) => d === c) !== i);
ok("no two roles share a colour", dupes.length === 0, dupes.map(([r]) => r).join(", "));

// Role colour is used as TEXT, so 4.5:1 is the bar, on the lightest surface.
const dim = colours.filter(([, c]) => worst(c) < 4.5);
ok("every role colour is readable on every surface", dim.length === 0,
   dim.map(([r, c]) => `${r} ${worst(c).toFixed(2)}:1`).join(", "));

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
let closest = [Infinity, "", ""];
for (let i = 0; i < colours.length; i++)
  for (let j = i + 1; j < colours.length; j++) {
    const d = dE(colours[i][1], colours[j][1]);
    if (d < closest[0]) closest = [d, colours[i][0], colours[j][0]];
  }
ok(`the closest pair is ${closest[0].toFixed(1)} apart (${closest[1]}/${closest[2]})`, closest[0] >= 8);

// Family is the other half of the signal: it says which domain of access a
// role sits in, so a colour carries meaning in two dimensions rather than one.
ok("every role declares a family", Object.values(ROLE_IDENTITY).every((id) => !!id.family));
const sameFamily = (a, b) => ROLE_IDENTITY[a].family === ROLE_IDENTITY[b].family;
ok("the closest pair is within one family or across adjacent ones",
   sameFamily(closest[1], closest[2]) ||
   ["platform", "governance"].every((f) => [ROLE_IDENTITY[closest[1]].family, ROLE_IDENTITY[closest[2]].family].includes(f)));

// The bug this whole file exists to fix, stated as a property: the live login
// picks the widest assignment a person holds and looks it up here. Sarah is a
// director of sport at one school and a guardian at another; `directorofsport`
// was a role the UI had never heard of, so signing in as her produced
// ROLES[undefined] — a working session with no navigation and no name.
for (const r of ["directorofsport", "principal", "teammanager", "official", "media", "scout"]) {
  ok(`a ${r} can be signed in and shown something`,
     !!ROLES[r]?.label && ROLES[r].nav.length > 0);
}

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
// Comments are stripped first: a hex named in a note ABOUT a colour — "the
// off-palette #22d3ee is gone" — is documentation, not a use of it, and
// counting it would make the check unable to describe its own history.
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
for (const f of files) {
  for (const m of stripComments(readFileSync(f, "utf8")).matchAll(/#([0-9a-fA-F]{6})\b/g)) {
    const hex = `#${m[1].toLowerCase()}`;
    if (!Object.values(HEX).map((h) => h.toLowerCase()).includes(hex)) adhoc.add(hex);
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

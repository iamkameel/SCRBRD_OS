/**
 * The drill map (GA-I26a §1.5, §7.2 item 6): every attribute in TREE pinned to
 * the drill categories that suit it, so a renamed attribute fails here and not
 * on a screen whose picker quietly stops ordering.
 *
 *   node packages/scoring/test/drillmap.test.mjs
 */
import {
  TREE, DISCIPLINES, DRILL_CATEGORIES, drillCategoriesFor, drillCategoriesForSession,
} from "../src/rubric.mjs";

let pass = 0, fail = 0;
/** @param {string} n @param {boolean} c @param {unknown} [d] */
const ok = (n, c, d) => { if (c) pass++; else { fail++; console.log("  ✗", n, d === undefined ? "" : `— ${JSON.stringify(d)}`); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);
const sorted = (/** @type {Set<string>} */ s) => [...s].sort().join(",");

// The whole map, written out. A change to TREE or DISCIPLINES that moves an
// attribute changes a line here, on purpose.
/** @type {Record<string, string>} */
const EXPECTED = {
  "technical.footwork": "batting", "technical.timing": "batting", "technical.power": "batting",
  "technical.shotRange": "batting", "technical.defence": "batting", "technical.againstPace": "batting",
  "technical.againstSpin": "batting",
  "technical.lineAndLength": "bowling", "technical.seamAndSwing": "bowling", "technical.spin": "bowling",
  "technical.variations": "bowling",
  "technical.catching": "fielding,keeping", "technical.groundFielding": "fielding", "technical.throwing": "fielding",
  "technical.glovework": "keeping",
  "mental.concentration": "batting,bowling,keeping", "mental.composure": "batting,bowling",
  "mental.decisions": "batting", "mental.anticipation": "fielding", "mental.determination": "",
  "mental.bravery": "batting", "mental.leadership": "", "mental.teamwork": "", "mental.workRate": "",
  "mental.gameAwareness": "",
  "tactical.strikeRotation": "batting,tactical", "tactical.oppositionAnalysis": "batting,bowling,tactical",
  "tactical.fieldPlacement": "bowling,fielding,tactical", "tactical.deathOversExecution": "batting,bowling,tactical",
  "physical.pace": "fitness", "physical.acceleration": "fielding,fitness", "physical.agility": "fielding,fitness,keeping",
  "physical.balance": "fitness,keeping", "physical.stamina": "bowling,fitness", "physical.strength": "fitness",
  "physical.naturalFitness": "fitness", "physical.bowlingPace": "bowling,fitness",
};

group("Every attribute in TREE is mapped, and only those");
{
  const all = Object.entries(TREE).flatMap(([c, ms]) => ms.map((m) => `${c}.${m}`));
  ok("the map names every attribute TREE has", all.every((k) => Object.hasOwn(EXPECTED, k)),
     all.filter((k) => !Object.hasOwn(EXPECTED, k)));
  ok("...and none it does not", Object.keys(EXPECTED).every((k) => all.includes(k)),
     Object.keys(EXPECTED).filter((k) => !all.includes(k)));
  for (const k of all) {
    const [c, m] = k.split(".");
    const got = sorted(drillCategoriesFor(c, m));
    ok(`${k} → {${EXPECTED[k]}}`, got === EXPECTED[k], got);
  }
}

group("The design's four, by name (§7.2 item 6)");
ok("againstPace → {batting}", sorted(drillCategoriesFor("technical", "againstPace")) === "batting");
ok("bowlingPace → {bowling, fitness}", sorted(drillCategoriesFor("physical", "bowlingPace")) === "bowling,fitness");
ok("fieldPlacement → {bowling, fielding, tactical}",
   sorted(drillCategoriesFor("tactical", "fieldPlacement")) === "bowling,fielding,tactical");
ok("leadership → {}", drillCategoriesFor("mental", "leadership").size === 0);

group("It refuses nothing and invents nothing");
ok("an unknown attribute maps to nothing", drillCategoriesFor("technical", "vibes").size === 0);
ok("an attribute under the wrong group maps to nothing", drillCategoriesFor("physical", "footwork").size === 0);
ok("an unknown group maps to nothing", drillCategoriesFor("sorcery", "footwork").size === 0);
ok("every answer is a drill category", Object.entries(TREE).every(([c, ms]) =>
  ms.every((m) => [...drillCategoriesFor(c, m)].every((x) => DRILL_CATEGORIES.includes(x)))));
ok("every discipline is a drill category", Object.keys(DISCIPLINES).every((d) => DRILL_CATEGORIES.includes(d)));
const one = drillCategoriesFor("technical", "againstPace");
one.add("fitness");
ok("a caller's change to an answer does not reach the next caller",
   sorted(drillCategoriesFor("technical", "againstPace")) === "batting");

group("A session's type is the plan editor's default filter");
for (const t of ["batting", "bowling", "fielding", "fitness"])
  ok(`${t} → {${t}}`, sorted(drillCategoriesForSession(t)) === t);
for (const t of ["technical", "skills", "match-prep"])
  ok(`${t} → every category`, drillCategoriesForSession(t).size === DRILL_CATEGORIES.length);

console.log(`\n${"─".repeat(52)}\nDRILL MAP SUITE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

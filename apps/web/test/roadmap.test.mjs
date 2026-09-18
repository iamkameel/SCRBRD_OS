/**
 * The roadmap says what it can keep.
 *
 * Settings › Roadmap and the pitch deck both read one list, and both used to
 * print a claim the list could not back: "a thing is shipped when a walk would
 * fail if it broke". Nothing checked it. The only test that touched the
 * roadmap compared the deck's three counts against the same array the deck
 * renders — proof that two screens agree with each other, and no evidence at
 * all about whether the ten shipped things are shipped.
 *
 * That claim is on a public demo page above a Sign in button, which is where a
 * headmaster reads it.
 *
 * So each shipped entry now names the walks that cover it, and this file
 * checks the naming is real: the walk exists on disk, and the runner will
 * actually run it. A walk deleted or renamed takes the claim down with it, in
 * the suite, rather than leaving the screen quietly overstating itself.
 *
 * WHAT THIS DOES NOT PROVE, and the screens were reworded to match: that the
 * named walk would fail if the feature broke. No test can prove that about
 * another test — a walk can be renamed, kept registered, and quietly gutted.
 * What is provable is that a named, registered walk exists, and that is what
 * the screens now say.
 *
 * Falsified by pointing an entry at a walk that does not exist, and by
 * removing a real walk from WALKS in the runner while leaving the file — the
 * two different ways the claim can rot.
 *
 *   node apps/web/test/roadmap.test.mjs
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { UPGRADES, STATUS_LABEL } from "../src/data/roadmap.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const RUNNER = readFileSync(join(ROOT, "tools/run-smoke-api.mjs"), "utf8");

let pass = 0, fail = 0;
const ok = (n, c, d = "") => { console.log(`${c ? "✓" : "✗"} ${n}${c || !d ? "" : `\n    ${d}`}`); c ? pass++ : fail++; };
const group = (t) => console.log("\n" + t);

/** Every walk name the runner will run, from all three of its lists. */
const registered = new Set(
  ["WALKS", "BROWSER_WALKS", "NO_DB"].flatMap((name) => {
    const block = RUNNER.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\]`))?.[1] ?? "";
    return (block.match(/"[a-z0-9-]*"/g) ?? []).map((s) => s.slice(1, -1)).filter(Boolean);
  }));

const shipped = UPGRADES.filter((u) => u.status === "shipped");

group("The list itself");
ok(`there are ${shipped.length} shipped items to hold to account`, shipped.length >= 8);
ok(`the runner knows ${registered.size} walks`, registered.size >= 50, [...registered].slice(0, 5).join(" "));
ok("every entry has one of the three statuses",
   UPGRADES.every((u) => ["shipped", "partial", "planned"].includes(u.status)),
   UPGRADES.filter((u) => !["shipped", "partial", "planned"].includes(u.status)).map((u) => u.id).join(" "));
ok("every status has a label to render", ["shipped", "partial", "planned"].every((s) => STATUS_LABEL[s]));
ok("ids are unique", new Set(UPGRADES.map((u) => u.id)).size === UPGRADES.length);

group("Every shipped item names the walk that covers it");
for (const u of shipped) {
  ok(`${u.id} names at least one walk`, Array.isArray(u.walk) && u.walk.length > 0, u.title);
}
{
  const missingFile = [];
  const unregistered = [];
  for (const u of shipped)
    for (const w of u.walk ?? []) {
      if (!existsSync(join(ROOT, `tools/smoke-${w}.mjs`))) missingFile.push(`${u.id}→${w}`);
      else if (!registered.has(w)) unregistered.push(`${u.id}→${w}`);
    }
  ok("every named walk exists on disk", missingFile.length === 0, missingFile.join(" "));
  ok("...and every one of them is registered to run", unregistered.length === 0, unregistered.join(" "));
}
{
  // The floor. If `walk` were dropped from every entry the two checks above
  // would iterate nothing and pass, which is the shape that has bitten this
  // codebase repeatedly.
  const named = shipped.flatMap((u) => u.walk ?? []);
  ok(`${named.length} walk references were actually checked`, named.length >= shipped.length);
}

group("And the other statuses stay honest");
ok("nothing that is not shipped claims a walk",
   UPGRADES.filter((u) => u.status !== "shipped").every((u) => u.walk === undefined),
   UPGRADES.filter((u) => u.status !== "shipped" && u.walk).map((u) => u.id).join(" "));
ok("every partial says what exists and what does not",
   UPGRADES.filter((u) => u.status === "partial").every((u) => (u.desc ?? "").length > 40));

// ── Understatement, which is the half the first version missed ──
//
// The checks above police a shipped item that claims too much. They are blind
// to a partial that claims too little, and that is the one that was actually
// wrong: up16 said "simply not shown" while RecognitionCard had been on the
// player profile since it was built, asserted by two walks. A roadmap that
// under-reports is a smaller problem than one that over-reports, and it is
// still a page telling a headmaster something untrue.
group("Nothing claims to be undrawn while a screen draws it");
{
  const walk = (dir) => readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
  const views = walk(join(ROOT, "apps/web/src/views"))
    .filter((f) => f.endsWith(".jsx") || f.endsWith(".js"))
    .map((f) => ({ f: f.slice(ROOT.length + 1), text: readFileSync(f, "utf8") }));
  const api = walk(join(ROOT, "services/api"))
    .filter((f) => f.endsWith(".mjs") && !f.includes(".test."))
    .map((f) => readFileSync(f, "utf8")).join("\n");

  const partials = UPGRADES.filter((u) => u.status === "partial");
  ok(`there are ${partials.length} partials, each naming what is not drawn`,
     partials.length > 0 && partials.every((u) => Array.isArray(u.undrawn) && u.undrawn.length),
     partials.filter((u) => !u.undrawn?.length).map((u) => u.id).join(" "));

  // Naming something REAL is the floor. An invented identifier nobody would
  // ever write would satisfy the check below forever.
  const unreal = partials.flatMap((u) => (u.undrawn ?? []).filter((n) => !api.includes(n)).map((n) => `${u.id}→${n}`));
  ok("every named identifier is real — it exists in services/api", unreal.length === 0, unreal.join(" "));

  const drawn = [];
  for (const u of partials)
    for (const n of u.undrawn ?? []) {
      const hit = views.find((v) => v.text.includes(n));
      if (hit) drawn.push(`${u.id} says "${n}" is undrawn, but ${hit.f} references it`);
    }
  ok("...and no view references one of them", drawn.length === 0, drawn.join(" · "));

  const checked = partials.flatMap((u) => u.undrawn ?? []).length;
  ok(`${checked} undrawn identifiers were actually checked against ${views.length} view files`,
     checked >= partials.length && views.length >= 10);
}

console.log("\n" + "─".repeat(52));
console.log(`ROADMAP: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

#!/usr/bin/env node
/**
 * The module registry, and the four ways it can be quietly wrong.
 *
 * Every assertion here is about DRIFT rather than about behaviour. The
 * mechanism itself is exercised end to end by tools/smoke-modules.mjs against
 * a real database; what a database walk cannot catch is a module declared in
 * JavaScript that has no row to switch, or a read claimed by a module that no
 * longer exists. Both fail silently and in the worst direction — the first
 * gives an administrator a switch that does nothing, the second refuses a read
 * for a module nobody can find.
 *
 *   node packages/policy/test/modules.test.mjs
 */
import { readFileSync } from "node:fs";
import { MODULES, FEATURES, SWITCHABLE, OWNER_OF_READ, MODULE_OF_NAV } from "../src/modules.mjs";
import { ALL_CAPABILITIES } from "../src/capabilities.mjs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const SCHEMA = readFileSync(new URL("../../../db/08_schema_programme.sql", import.meta.url), "utf8");
// The seeded rows, as the migration actually writes them. Parsed rather than
// duplicated: a copy of the list in this file would be a third place to drift.
const seeded = new Set(
  [...SCHEMA.matchAll(/^\s*\('([a-z_]+)',\s*'(module|feature)'/gm)].map((m) => m[1]));

group("A. Every switch has a row to switch");
for (const key of Object.keys(SWITCHABLE)) {
  // Without this, an administrator's screen shows a module, they turn it off,
  // and nothing happens: feature_enabled() answers false for an unknown key,
  // so the module was never on and never will be.
  ok(`${key} is seeded in db/08`, seeded.has(key));
}

group("B. Every seeded row has a declaration");
for (const key of seeded) {
  // The other direction, and the more dangerous one: a row nobody declares is
  // a switch that gates no reads and no routes. It looks like it works.
  ok(`${key} is declared in modules.mjs`, !!SWITCHABLE[key]);
}

group("C. A module's kind and its table agree");
{
  const kindInSql = Object.fromEntries(
    [...SCHEMA.matchAll(/^\s*\('([a-z_]+)',\s*'(module|feature)'/gm)].map((m) => [m[1], m[2]]));
  for (const [key, def] of Object.entries(SWITCHABLE)) {
    ok(`${key} is a ${def.kind} in both places`, kindInSql[key] === def.kind);
  }
  ok("every module declares kind module",
     Object.values(MODULES).every((d) => d.kind === "module"));
  ok("every feature declares kind feature",
     Object.values(FEATURES).every((d) => d.kind === "feature"));
}

group("D. Modules name capabilities that exist");
{
  const caps = new Set(ALL_CAPABILITIES);
  for (const [key, def] of Object.entries(MODULES)) {
    // The module gate is an AND on top of the capability, so a module naming a
    // capability nobody holds is a destination nobody reaches — and a module
    // naming a MISSPELLED capability is worse, because roleGrants() answers
    // false for an unknown name and the destination silently vanishes for
    // everybody.
    ok(`${key} names a real capability`, caps.has(def.capability));
  }
}

group("E. No read has two owners");
{
  // OWNER_OF_READ throws at import time on a double claim, so reaching this
  // line at all is most of the assertion. The count is the rest of it.
  const claimed = Object.values(SWITCHABLE).flatMap((d) => d.reads ?? []);
  ok("every claimed read is claimed once",
     claimed.length === new Set(claimed).size);
  ok("the owner map covers all of them",
     claimed.every((r) => !!OWNER_OF_READ[r]));
}

group("F. Shared infrastructure stays unclaimed");
{
  // The reads a dozen screens depend on. Claiming one would mean switching off
  // a single module blanked the opponent's name in Match Centre, or emptied
  // the squad list — a setting whose blast radius nobody predicted from its
  // name. If a module genuinely needs to own one of these, this assertion is
  // the conversation, not an obstacle to route around.
  for (const r of ["matches", "players", "live_score", "summary", "notifications",
                   "users", "grounds", "competitions", "career", "match_squad"]) {
    ok(`${r} is not owned by any module`, !OWNER_OF_READ[r]);
  }
}

group("G. Every gated destination is a real one");
{
  const navKeys = Object.values(MODULES).map((d) => d.nav).filter(Boolean);
  ok("each module gates at most one destination",
     navKeys.length === new Set(navKeys).size);
  ok("the nav map is the inverse of the module list",
     Object.entries(MODULE_OF_NAV).every(([nav, key]) => MODULES[key].nav === nav));
  // Somebody's own screens must not be switchable. A product that lets a
  // school hide a person's own settings or their own alerts has stopped being
  // theirs — which is why these are absent from MODULES rather than present
  // and marked.
  for (const own of ["dashboard", "settings", "notifications", "profiles"]) {
    ok(`${own} cannot be switched off`, !MODULE_OF_NAV[own]);
  }
}

console.log(`\n${"─".repeat(52)}\nMODULES SUITE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

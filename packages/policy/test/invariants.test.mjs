#!/usr/bin/env node
/**
 * SCRBRD-031. The workflow-state inventory, and what it turned out to be.
 *
 * Roles&Duty.md §2.1 requires every action to pass four controls — role,
 * scope, relationship and WHEN. The first three are `authorize()`, the scope
 * columns on role_assignment, and the guardian/self relationships. The fourth
 * returned zero hits in this tree, and the entry that raised it assumed the
 * answer was a missing authorisation layer.
 *
 * It is not. The inventory says something better.
 *
 * Reading every trigger function in db/, thirty of them refuse something, and
 * they fall into three kinds:
 *
 *   PURE INVARIANT (19) — refuses on the state of the RECORD and never asks
 *     who is calling. A withdrawn honour is not edited. A fixture's sport is
 *     frozen once it has a ball log. ball_event is append-only. The rule is
 *     the same for a scorer and for superadmin, because it is not about them.
 *
 *   STAMP (10) — writes app_user_id() onto the row so the act has an author.
 *     It reads the principal; it does not gate on one.
 *
 *   CAPABILITY GATE (1) — sponsorship_exclusivity_gate, which is an approval
 *     rather than an invariant: `sponsorship.exclusivity.waive` exists so that
 *     a governance role CAN override an exclusivity clash. Named below.
 *
 * So workflow state here is not a fourth authorisation layer. It sits BELOW
 * authorisation, in the database, where no role can be granted past it — which
 * is stronger than beta-2's model, where "when" is a control alongside role and
 * scope and therefore something a sufficiently privileged role could be given.
 * A rule any capability can bypass is a privilege, not an invariant.
 *
 * This suite keeps that true. The day somebody adds `AND NOT
 * app_is_platform_wide()` to one of the nineteen to unblock a support session,
 * the invariant quietly becomes a privilege and this goes red.
 *
 * Falsified by adding a capability check to ball_event_immutable — the count
 * drops and the new gate is named — and by emptying APPROVALS, which reports
 * the one legitimate gate instead of passing on a shorter list.
 *
 *   node packages/policy/test/invariants.test.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// SCRBRD_DB_DIR exists so this suite can be falsified against a scratch copy
// of db/. The migrations it reads are frozen — tools/hooks/guard.mjs refuses
// an edit to them, correctly, and it refused the first attempt at the
// falsification below. A test that can only be proven by breaking a rule the
// project enforces is a test nobody proves twice.
const DB = process.env.SCRBRD_DB_DIR
  ?? join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "db");

let pass = 0, fail = 0;
const ok = (/** @type {string} */ n, /** @type {unknown} */ c, d = "") => { console.log(`${c ? "✓" : "✗"} ${n}${c || !d ? "" : `\n    ${d}`}`); c ? pass++ : fail++; };
const group = (/** @type {string} */ t) => console.log("\n" + t);

const sql = readdirSync(DB).filter((f) => f.endsWith(".sql")).sort()
  .map((f) => readFileSync(join(DB, f), "utf8")).join("\n");

const TRIGGERS = [...sql.matchAll(
  /CREATE (?:OR REPLACE )?FUNCTION ([a-z_0-9]+)\s*\([^)]*\)\s*RETURNS trigger AS \$\$([\s\S]*?)\$\$ LANGUAGE/g)]
  .map(([, name, body]) => ({ name, body }));

const GATES  = /app_can\s*\(|app_is_platform_wide\s*\(|my_feature_enabled\s*\(/;
const refusing = TRIGGERS.filter((t) => /RAISE EXCEPTION/.test(t.body));

/**
 * Refusing triggers that DO gate on a capability, and why that is right.
 *
 * An entry here is a rule somebody may override by holding something. Each
 * needs a reason, and each is checked to still gate — an approval that has
 * become an invariant should lose its entry rather than keep a licence it no
 * longer uses.
 */
const APPROVALS = {
  sponsorship_exclusivity_gate:
    "An exclusivity clash between two sponsors is a commercial decision, not a " +
    "record invariant. `sponsorship.exclusivity.waive` exists so a governance " +
    "role can take it deliberately and be named doing so, which is the whole " +
    "reason the capability is separate from sponsorship.manage.",
};

group("The inventory");
ok(`db/ holds ${TRIGGERS.length} trigger functions`, TRIGGERS.length >= 30, `${TRIGGERS.length}`);
ok(`${refusing.length} of them refuse something`, refusing.length >= 25, `${refusing.length}`);
ok("...which is most of them, or this suite is reading the wrong thing",
   refusing.length >= TRIGGERS.length / 2);

group("A state rule no role can be granted past");
{
  const gating = refusing.filter((t) => GATES.test(t.body)).map((t) => t.name);
  const unrecorded = gating.filter((n) => !(n in APPROVALS));
  ok("no refusing trigger gates on a capability, beyond the recorded approvals",
     unrecorded.length === 0,
     `these became privileges rather than invariants: ${unrecorded.join(", ")}`);

  const stale = Object.keys(APPROVALS).filter((n) => !gating.includes(n));
  ok("...and every recorded approval still gates on one", stale.length === 0,
     `no longer gating — delete from APPROVALS: ${stale.join(", ")}`);
  ok("...and each says why it may be overridden",
     Object.values(APPROVALS).every((r) => typeof r === "string" && r.length > 80));
  ok("...and names a trigger that exists",
     Object.keys(APPROVALS).every((n) => TRIGGERS.some((t) => t.name === n)),
     Object.keys(APPROVALS).filter((n) => !TRIGGERS.some((t) => t.name === n)).join(" "));

  // The floor. An empty or mis-parsed TRIGGERS list would make every check
  // above true about nothing.
  const invariants = refusing.filter((t) => !GATES.test(t.body));
  ok(`${invariants.length} refusing triggers consult no capability at all`,
     invariants.length >= 15, invariants.map((t) => t.name).slice(0, 4).join(" "));
  ok("the parse found real bodies, not empty strings",
     refusing.every((t) => t.body.length > 40));
}

group("The rules a reader should be able to find by name");
for (const [name, what] of [
  ["ball_event_immutable",                  "the ball log is append-only"],
  ["match_sport_is_frozen_once_played",     "a fixture's sport is frozen once it has a ball log"],
  ["match_away_side_is_frozen_once_played", "and so is the away side"],
  ["match_toss_before_first_ball",          "the toss cannot be recorded after play has started"],
  ["reward_weight_is_immutable",            "a reward coefficient does not move under the people it scored"],
  ["feature_suppression_lift_only",         "a suppression is lifted, never edited"],
])
  ok(`${what} (${name})`, TRIGGERS.some((t) => t.name === name));

console.log("\n" + "─".repeat(52));
console.log(`INVARIANTS: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

/**
 * Proves two things:
 *   A. policy.mjs decide()/canScore() reproduce every RBAC guarantee the app
 *      relies on (so the shared brain is correct).
 *   B. the generated SQL faithfully reflects that brain (so client and DB can't
 *      diverge), plus drift guards.
 *
 * What this does NOT do: run against live Postgres. That is rls_verify.sql,
 * which the engineer runs after applying the migration.
 */
import { POLICY, ROLES, decide, canScore, fieldDenied, RESOURCE_TABLES } from "./policy.mjs";
import { main } from "./generate-rls.mjs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = t => console.log("\n" + t);

// ── A. Decision brain — the guarantees the product depends on ──
group("A. Row visibility (scope)");
ok("spectator CANNOT read injuries",      decide("spectator","injuries","r").allowed === false);
ok("driver CANNOT read injuries",         decide("driver","injuries","r").allowed === false);
ok("analyst CANNOT read injuries",        decide("analyst","injuries","r").allowed === false);
ok("medical CAN read injuries (school)",  decide("medical","injuries","r").allowed && decide("medical","injuries","r").scope === "school");
ok("coach reads players at TEAM scope",   decide("coach","players","r").scope === "team");
ok("player reads profiles at OWN scope",  decide("player","profiles","r").scope === "own");
ok("parent matches = SCHOOL (per-res)",   decide("parent","matches","r").scope === "school");
ok("parent injuries = OWN (per-res)",     decide("parent","injuries","r").scope === "own");
ok("spectator players = no access",       decide("spectator","players","r").allowed === false);

group("A. Field masking (deny)");
ok("analyst players PII stripped (born)", fieldDenied("analyst","players","born") === true);
ok("analyst keeps non-PII (name)",        fieldDenied("analyst","players","name") === false);
ok("spectator profiles = fully denied",   decide("spectator","profiles","r").allowed === false);
  ok("analyst profiles PII stripped",       fieldDenied("analyst","profiles","phone") === true);
ok("medical sees clinical notes",         fieldDenied("medical","injuries","notes") === false);
ok("assistant injuries clinical hidden",  fieldDenied("assistant","injuries","notes") === true);
ok("schooladmin injuries clinical hidden",fieldDenied("schooladmin","injuries","physio") === true);
ok("financeadmin profile fields hidden",  fieldDenied("financeadmin","profiles","guardian") === true);

group("A. Write capability");
ok("coach can update injuries",           decide("coach","injuries","update").allowed === true);
ok("analyst is read-only",                decide("analyst","players","create").allowed === false);
ok("driver cannot update matches",        decide("driver","matches","update").allowed === false);
ok("scorer can create matches",           decide("scorer","matches","create").allowed === true);
ok("spectator cannot write anything",     ["players","injuries","matches"].every(r => !decide("spectator",r,"create").allowed));

group("A. Scoring capability (headline security fix)");
["superadmin","sportsmaster","headcoach","coach","assistant","scorer"].forEach(r => ok(`${r} CAN score`, canScore(r) === true));
["headmaster","schooladmin","financeadmin","analyst","medical","groundskeeper","driver","player","parent","spectator","platformsupport"]
  .forEach(r => ok(`${r} CANNOT score`, canScore(r) === false));
ok("unknown role denied", canScore("intruder") === false);
ok("unknown role no read", decide("intruder","players","r").allowed === false);

// ── B. Generated SQL faithfulness ──
const SQL = main();
group("B. Generated SQL reflects the policy");
ok("emits rbac_scope function",          /CREATE OR REPLACE FUNCTION rbac_scope/.test(SQL));
ok("emits rbac_can_read (inScope mirror)", /rbac_can_read/.test(SQL) && /WHEN 'own'\s+THEN p_owner = app_player_id\(\) OR p_owner = ANY\(app_child_ids\(\)\)/.test(SQL));
ok("emits rbac_can_write capability fn", /CREATE OR REPLACE FUNCTION rbac_can_write/.test(SQL));
ok("emits rbac_field_denied fn",         /CREATE OR REPLACE FUNCTION rbac_field_denied/.test(SQL));
ok("every RBAC table gets RLS enabled",  Object.keys(RESOURCE_TABLES).every(t => new RegExp(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`).test(SQL)));
ok("every RBAC table gets a read policy",Object.keys(RESOURCE_TABLES).every(t => new RegExp(`POLICY ${t}_rbac_read`).test(SQL)));
ok("injury anchors via linked player",   /team_code FROM player WHERE player\.id = injury\.player_id/.test(SQL));

// Faithfulness spot-checks: the SQL scope table must equal decide()'s scope
group("B. SQL scope entries match decide() exactly");
let scopeMismatch = 0;
for (const role of ROLES) {
  for (const { resource } of Object.values(RESOURCE_TABLES)) {
    const expected = decide(role, resource, "r").allowed ? decide(role, resource, "r").scope : "none";
    const rx = new RegExp(`WHEN p_role = '${role}' AND p_resource = '${resource}' THEN '${expected}'`);
    if (!rx.test(SQL)) { scopeMismatch++; if (scopeMismatch <= 3) console.log(`    scope mismatch: ${role}/${resource} expected ${expected}`); }
  }
}
ok("all role×resource scope rows faithful", scopeMismatch === 0);

group("B. Masking views exist for PII/clinical tables");
ok("player_masked view generated",  /CREATE OR REPLACE VIEW player_masked/.test(SQL));
ok("injury_masked view generated",  /CREATE OR REPLACE VIEW injury_masked/.test(SQL));
ok("mask view nulls a denied field",/CASE WHEN rbac_field_denied\('players', 'born'\) THEN NULL ELSE born END/.test(SQL));

group("B. Drift guards");
ok("every POLICY role appears in rbac_scope", ROLES.every(r => new RegExp(`p_role = '${r}'`).test(SQL)));
ok("no hand-edit marker missing",             /DO NOT EDIT BY HAND/.test(SQL));
ok("scoring roles list in SQL comment",       /Roles that may score: .*scorer/.test(SQL));

console.log(`\n${"─".repeat(52)}\nRLS SUITE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

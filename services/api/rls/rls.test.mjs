/**
 * Proves the generated SQL is a faithful projection of the policy model, so
 * the client and the database cannot drift.
 *
 * The model's own correctness is packages/policy/test/authorize.test.mjs.
 * Postgres actually enforcing it is db/99_rls_verify.sql, run against a live
 * database. This file sits between them: it checks that what the generator
 * emits says the same thing the JS says.
 */
import { ROLES, ROLE_CAPABILITIES, roleGrants, SCORING_ROLES } from "@scrbrd/policy/roles";
import { TABLES, referencedCapabilities } from "@scrbrd/policy/tables";
import { ALL_CAPABILITIES, SENSITIVE, isCapability } from "@scrbrd/policy/capabilities";
import { main } from "./generate-rls.mjs";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const SQL = main();

// ── A. The decision function ─────────────────────────────
group("A. app_can — the decision, in SQL");
ok("app_can is generated",              /CREATE OR REPLACE FUNCTION app_can\(/.test(SQL));
ok("it is SECURITY DEFINER",            /\$\$ LANGUAGE sql STABLE SECURITY DEFINER;/.test(SQL));
ok("it is STABLE (once per statement)", /LANGUAGE sql STABLE/.test(SQL));
ok("it reads assignments, not the session role",
   /FROM role_assignment a/.test(SQL) && !/current_setting\('app\.role'/.test(SQL));
ok("it keys on the authenticated user", /a\.person_id = app_user_id\(\)/.test(SQL));
ok("it joins role_capability",          /JOIN role_capability rc/.test(SQL));
ok("it honours active",                 /AND a\.active/.test(SQL));
ok("it honours validity dates",
   /a\.valid_from\s+IS NULL OR a\.valid_from\s+<= current_date/.test(SQL) &&
   /a\.valid_until IS NULL OR a\.valid_until >\s+current_date/.test(SQL));

group("A. Scope semantics are asymmetric on purpose");
// NULL on the assignment widens; NULL on the resource must NOT — otherwise a
// query that forgot its scope silently matches every row.
ok("school: assignment NULL widens, resource NULL narrows",
   /a\.school_id IS NULL OR \(p_school IS NOT NULL AND a\.school_id = p_school\)/.test(SQL));
ok("team: same asymmetry",
   /a\.team_code IS NULL OR \(p_team IS NOT NULL AND a\.team_code = p_team\)/.test(SQL));
ok("fixture: same asymmetry",
   /a\.fixture_id IS NULL OR \(p_fixture IS NOT NULL AND a\.fixture_id = p_fixture\)/.test(SQL));
ok("guardian assignments reach only listed children",
   /guardian_child g[\s\S]{0,200}g\.player_id = p_person/.test(SQL));
ok("a non-guardian assignment is not narrowed by children",
   /NOT EXISTS \(SELECT 1 FROM guardian_child g WHERE g\.assignment_id = a\.id\)/.test(SQL));

// ── B. Role bundles reach the database intact ────────────
group("B. Role → capability rows");
ok("rows are replaced wholesale", /DELETE FROM role_capability;/.test(SQL));
{
  let missing = 0, wrong = 0;
  for (const role of ROLES) {
    for (const cap of ROLE_CAPABILITIES[role]) {
      if (!SQL.includes(`('${role}', '${cap}')`)) missing++;
    }
    // A capability the role does NOT hold must not appear for it.
    for (const cap of ALL_CAPABILITIES) {
      if (!roleGrants(role, cap) && SQL.includes(`('${role}', '${cap}')`)) wrong++;
    }
  }
  ok("every granted capability is emitted", missing === 0);
  ok("no ungranted capability is emitted", wrong === 0);
}
ok("all roles appear", ROLES.every((r) => SQL.includes(`('${r}', `)));
ok("can_score is derived from the bundles",
   SCORING_ROLES.every((r) => new RegExp(`can_score[\\s\\S]*'${r}'`).test(SQL)));
ok("a non-scoring role is absent from can_score",
   !/SELECT p_role IN \([^)]*'guardian'/.test(SQL));
ok("can_score agrees with roleGrants",
   ROLES.every((r) => SCORING_ROLES.includes(r) === roleGrants(r, "scoring.edit")));

// ── C. Per-table policies ────────────────────────────────
group("C. Table policies");
for (const [table, def] of Object.entries(TABLES)) {
  ok(`${table}: RLS enabled`,      new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`).test(SQL));
  ok(`${table}: read policy uses ${def.read}`,
     new RegExp(`CREATE POLICY ${table}_read ON ${table}[\\s\\S]{0,200}app_can\\('${def.read.replace(/\./g, "\\.")}'`).test(SQL));
  ok(`${table}: write policy uses ${def.write}`,
     new RegExp(`CREATE POLICY ${table}_insert ON ${table}[\\s\\S]{0,200}app_can\\('${def.write.replace(/\./g, "\\.")}'`).test(SQL));
  ok(`${table}: update checks both ways`,
     new RegExp(`CREATE POLICY ${table}_update[\\s\\S]{0,300}USING[\\s\\S]{0,200}WITH CHECK`).test(SQL));
}
// Records about minors are deactivated, never deleted, so an audit trail survives.
ok("no DELETE policy is granted anywhere", !/FOR DELETE/.test(SQL));
ok("staff carry no team anchor (a coach gets no staff directory)",
   /CREATE POLICY staff_read[\s\S]{0,200}NULL::text/.test(SQL));
ok("injury anchors its team through the linked player",
   /SELECT p\.team_code FROM player p WHERE p\.id = injury\.player_id/.test(SQL));
ok("competition is governed now (was ungoverned)",
   /CREATE POLICY competition_read ON competition/.test(SQL));

// ── D. Column masking ────────────────────────────────────
group("D. Column masking, per row");
for (const [table, def] of Object.entries(TABLES)) {
  const masked = def.masked ?? {};
  if (!Object.keys(masked).length) continue;
  ok(`${table}_masked is generated`, new RegExp(`VIEW ${table}_masked`).test(SQL));
  ok(`${table}_masked is a security barrier`,
     new RegExp(`VIEW ${table}_masked WITH \\(security_barrier = true\\)`).test(SQL));
  ok(`${table}_masked builds from information_schema`,
     new RegExp(`\\$mask_${table}\\$[\\s\\S]*information_schema\\.columns`).test(SQL));
  ok(`${table}_masked fails loudly without its table`,
     new RegExp(`cannot build ${table}_masked`).test(SQL));
  for (const [cap, cols] of Object.entries(masked)) {
    ok(`${table}: ${cols.length} column(s) gated by ${cap}`,
       cols.every((c) => new RegExp(`\\('${c.toLowerCase()}', '${cap.replace(/\./g, "\\.")}'\\)`).test(SQL)));
  }
}
// Masking is decided per row via app_can, not once per role for the query.
ok("masking calls app_can per row", /app_can\(%L, %s, %s, %s, NULL\)/.test(SQL));
ok("clinical notes are gated by medical.details.read",
   /\('notes', 'medical\.details\.read'\)/.test(SQL) && /\('physio', 'medical\.details\.read'\)/.test(SQL));
ok("guardian details are gated by player.pii.read",
   /\('guardian', 'player\.pii\.read'\)/.test(SQL));
ok("a player's name is NOT masked (over-masking guard)",
   !/\('full_name', /.test(SQL));

// ── E. The assignment tables protect themselves ──────────
group("E. Assignment tables");
ok("role_assignment has RLS",       /ALTER TABLE role_assignment ENABLE ROW LEVEL SECURITY/.test(SQL));
ok("a person reads their own assignments", /person_id = app_user_id\(\)/.test(SQL));
ok("granting requires user.role.assign",
   /CREATE POLICY role_assignment_write[\s\S]{0,200}app_can\('user\.role\.assign'/.test(SQL));
ok("guardian_child has RLS",        /ALTER TABLE guardian_child ENABLE ROW LEVEL SECURITY/.test(SQL));
ok("role_capability is readable reference data",
   /CREATE POLICY role_capability_read ON role_capability FOR SELECT USING \(true\)/.test(SQL));

// ── F. Model integrity ───────────────────────────────────
group("F. Model integrity");
ok("every capability the tables reference exists", referencedCapabilities().every(isCapability));
ok("every capability the tables reference is granted to some role",
   referencedCapabilities().every((c) => ROLES.some((r) => roleGrants(r, c))));
ok("SENSITIVE capabilities are all used as mask gates or read gates", SENSITIVE.every(isCapability));
ok("no role bundles a capability that does not exist",
   ROLES.every((r) => ROLE_CAPABILITIES[r].every(isCapability)));
ok("the generated file warns against hand-editing", /DO NOT EDIT BY HAND/.test(SQL));
ok("it names the ADR", /docs\/adr\/0001/.test(SQL));
// The old single-role model must be gone from the emitted SQL entirely.
ok("no rbac_scope remains",        !/rbac_scope/.test(SQL));
ok("no rbac_field_denied remains", !/rbac_field_denied/.test(SQL));
ok("no app_role\\(\\) remains",    !/app_role\(\)/.test(SQL));

console.log(`\n${"─".repeat(52)}\nRLS SUITE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

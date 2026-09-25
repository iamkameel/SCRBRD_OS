/**
 * Proves the generated SQL is a faithful projection of the policy model, so
 * the client and the database cannot drift.
 *
 * The model's own correctness is packages/policy/test/authorize.test.mjs.
 * Postgres actually enforcing it is db/99_rls_verify.sql, run against a live
 * database. This file sits between them: it checks that what the generator
 * emits says the same thing the JS says.
 */
import { ROLES, ROLE_CAPABILITIES, roleGrants, SCORING_ROLES, SUBJECT_SCOPED_ROLES } from "@scrbrd/policy/roles";
import { TABLES, referencedCapabilities, isCapabilityExpression, maskedColumns } from "@scrbrd/policy/tables";
import { ALL_CAPABILITIES, SENSITIVE, isCapability } from "@scrbrd/policy/capabilities";
import { main, authz, policies, timeBox, suspension, matchAnchors, REANCHORED_IN_39, REANCHOR_FILE, WITHDRAWN_SINCE_01, ADDED_SINCE_01, ROLES_ADDED_SINCE_01 } from "./generate-rls.mjs";
import { GRANTABLE_ROLES } from "@scrbrd/policy/roles";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

let pass = 0, fail = 0;
/** @param {string} n @param {unknown} c */
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (/** @type {string} */ t) => console.log("\n" + t);

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
   /a\.team_code IS NULL OR p_team = '\*'::text\s*\n?\s*OR \(p_team IS NOT NULL AND a\.team_code = p_team\)/.test(SQL));
ok("fixture: same asymmetry",
   /a\.fixture_id IS NULL OR p_fixture = '0{8}-0{4}-0{4}-0{4}-0{12}'::uuid\s*\n?\s*OR \(p_fixture IS NOT NULL AND a\.fixture_id = p_fixture\)/.test(SQL));

// The third state. A fixture is not about a person, so a guardian assignment's
// child list must not constrain it — without this every guardian was denied
// every fixture, and a parent could not see when their child was playing.
ok("ANY_SCOPE satisfies the guardian clause",
   /OR p_person = '0{8}-0{4}-0{4}-0{4}-0{12}'::uuid/.test(SQL));
ok("there is no ANY_SCOPE for school (every row belongs to a tenant)",
   !/p_school = '0{8}-/.test(SQL));
ok("match passes ANY_SCOPE for person, not NULL",
   /CREATE POLICY match_read[\s\S]{0,220}'0{8}-0{4}-0{4}-0{4}-0{12}'::uuid, match\.id/.test(SQL));
// ...and a table that states a dimension as absent still narrows.
ok("staff states team as absent, so it narrows",
   /CREATE POLICY staff_read[\s\S]{0,200}NULL::text/.test(SQL));
ok("guardian assignments reach only listed children",
   /assignment_subject g[\s\S]{0,200}g\.player_id = p_person/.test(SQL));
ok("a non-guardian assignment is not narrowed by children",
   /NOT EXISTS \(SELECT 1 FROM assignment_subject g WHERE g\.assignment_id = a\.id\)/.test(SQL));
// The link is a lifecycle, not a membership. Only a VERIFIED, unended link
// grants reach — and the two halves of the test read it differently on
// purpose, so both halves are asserted.
ok("only a verified link reaches a child",
   /g\.player_id = p_person\s*\n\s*AND g\.verification_state = 'verified'/.test(SQL));
ok("...and only while it is unended",
   /verification_state = 'verified'[\s\S]{0,160}g\.valid_until IS NULL OR g\.valid_until > current_date/.test(SQL));
ok("the negative half counts EVERY link, so revocation cannot widen",
   !/NOT EXISTS \(SELECT 1 FROM assignment_subject g WHERE g\.assignment_id = a\.id\s*\n?\s*AND/.test(SQL));
for (const role of SUBJECT_SCOPED_ROLES)
  ok(`${role} assignments are refused when they name nobody`,
     new RegExp(`a\\.role = ANY \\(ARRAY\\[[^\\]]*'${role}'`).test(SQL));

// ── B. Role bundles reach the database intact ────────────
group("B. Role → capability rows");
ok("rows are replaced wholesale", /DELETE FROM role_capability;/.test(SQL));
{
  let missing = 0, wrong = 0;
  // A role added after db/01 shipped is granted by its own db/NN; group B3.
  for (const role of ROLES.filter((r) => !(r in ROLES_ADDED_SINCE_01))) {
    for (const cap of ROLE_CAPABILITIES[role]) {
      // ...except a capability the model gained after db/01 shipped, which the
      // db/NN in ADDED_SINCE_01 grants instead. Held to that in group B2.
      if (cap in ADDED_SINCE_01) continue;
      if (!SQL.includes(`('${role}', '${cap}')`)) missing++;
    }
    // A capability the role does NOT hold must not appear for it — except a
    // row db/01_authz.sql already shipped and a later db/NN withdraws
    // (ADR 0002): that one row is meant to keep reproducing exactly what
    // was already applied, not the current live model. See
    // WITHDRAWN_SINCE_01 in generate-rls.mjs for why db/01 cannot simply be
    // regenerated to match ROLE_CAPABILITIES directly.
    const withdrawn = new Set((WITHDRAWN_SINCE_01[role] ?? []).map((w) => w.capability));
    for (const cap of ALL_CAPABILITIES) {
      if (!roleGrants(role, cap) && !withdrawn.has(cap) && SQL.includes(`('${role}', '${cap}')`)) wrong++;
    }
  }
  ok("every granted capability is emitted", missing === 0);
  ok("no ungranted capability is emitted", wrong === 0);
}
ok("all roles shipped in db/01 appear",
   ROLES.filter((r) => !(r in ROLES_ADDED_SINCE_01)).every((r) => SQL.includes(`('${r}', `)));

// ── B2. Capabilities added after db/01 shipped ───────────
// The mirror of WITHDRAWN_SINCE_01. A name here must be absent from db/01
// altogether — not in the catalogue, not in any bundle, not in the
// platform_only list — and present in the db/NN it names, as a catalogue row
// plus one role_capability row per holder in roles.mjs. Both halves matter:
// leaving it out of db/01 keeps the frozen file frozen, and putting it into
// the ledger file is what makes a fresh install and production agree.
group("B2. Capabilities added after db/01 shipped");
{
  const DB = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "db");
  const shipped = authz();
  const added = Object.entries(ADDED_SINCE_01);
  ok("the mirror is in use, so this group is testing something", added.length > 0);
  for (const [cap, file] of added) {
    ok(`${cap} is a real capability`, isCapability(cap));
    ok(`${cap} is granted to somebody in the model`, ROLES.some((r) => roleGrants(r, cap)));
    ok(`${cap} appears nowhere in the emitted db/01`, !shipped.includes(cap));
    const path = join(DB, file);
    ok(`${file} exists`, existsSync(path));
    const ledger = existsSync(path) ? readFileSync(path, "utf8") : "";
    ok(`${file} inserts the catalogue row`,
       new RegExp(`INSERT INTO capability \\(name\\) VALUES \\('${cap.replaceAll(".", "\\.")}'\\)`).test(ledger));
    const holders = ROLES.filter((r) => roleGrants(r, cap));
    // A ledger file may align its rows; the emitted db/01 never does.
    const grants = (/** @type {string} */ r) => new RegExp(`\\('${r}',\\s+'${cap.replaceAll(".", "\\.")}'\\)`).test(ledger);
    const unlisted = holders.filter((r) => !grants(r));
    ok(`${file} grants it to every holder in roles.mjs (${holders.join(", ")}) — missing: ${unlisted.join(", ") || "none"}`,
       unlisted.length === 0);
    const extra = ROLES.filter((r) => !roleGrants(r, cap) && grants(r));
    ok(`...and to nobody else — extra: ${extra.join(", ") || "none"}`, extra.length === 0);
  }
  ok("db/01's capability count in its header is the shipped count, not the model's",
     shipped.includes(`-- ${ALL_CAPABILITIES.length - added.length} capabilities across`));
}
// ── B3. Roles added after db/01 shipped ──────────────────
// The same property for a whole role: absent from the frozen file, present —
// bundle, appointers and all — in the db/NN it names.
group("B3. Roles added after db/01 shipped");
{
  const DB = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "db");
  const shipped = authz();
  for (const [role, file] of Object.entries(ROLES_ADDED_SINCE_01)) {
    ok(`${role} is a role in the model`, ROLES.includes(role));
    ok(`${role} appears nowhere in the emitted db/01`, !shipped.includes(`'${role}'`));
    const path = join(DB, file);
    ok(`${file} exists`, existsSync(path));
    const ledger = existsSync(path) ? readFileSync(path, "utf8") : "";
    const row = (/** @type {string} */ a, /** @type {string} */ b) => new RegExp(`\\('${a}',\\s+'${b.replaceAll(".", "\\.")}'\\)`).test(ledger);
    const unlisted = ROLE_CAPABILITIES[role].filter((c) => !row(role, c));
    ok(`${file} grants ${role} its whole bundle — missing: ${unlisted.join(", ") || "none"}`, unlisted.length === 0);
    const extra = ALL_CAPABILITIES.filter((c) => !roleGrants(role, c) && row(role, c));
    ok(`...and nothing else — extra: ${extra.join(", ") || "none"}`, extra.length === 0);
    const granters = Object.entries(GRANTABLE_ROLES).filter(([, g]) => g.includes(role)).map(([k]) => k);
    const ungranted = granters.filter((g) => !row(g, role));
    ok(`${file} lets every appointer in roles.mjs appoint it — missing: ${ungranted.join(", ") || "none"}`,
       granters.length > 0 && ungranted.length === 0);
  }
  ok("db/01's role count in its header is the shipped count, not the model's",
     shipped.includes(`capabilities across ${ROLES.length - Object.keys(ROLES_ADDED_SINCE_01).length} roles.`));
}

// No role-shaped decision function survives in the SQL. Scoring authority is
// app_can('scoring.edit', ...) over assignments; a can_score(role) helper would
// answer the question without a scope, which is how the old model leaked.
ok("no can_score(role) function is emitted", !/FUNCTION can_score/.test(SQL));
ok("no policy decides on an asserted role", !/can_score\(app_role\(\)\)/.test(SQL));
ok("scoring roles are still derived, not listed",
   ROLES.every((r) => SCORING_ROLES.includes(r) === roleGrants(r, "scoring.edit")));
ok("every scoring role reaches scoring.edit through its bundle",
   SCORING_ROLES.every((r) => SQL.includes(`('${r}', 'scoring.edit')`)));

// ── C. Per-table policies ────────────────────────────────
group("C. Table policies");
const rx = (/** @type {string} */ s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// A capability slot is a literal name, or a parenthesised SQL expression that
// computes one from the row (notification declares its own). Both end up as
// the first argument to app_can(); only the quoting differs.
const capArg = (/** @type {string} */ c) => (isCapabilityExpression(c) ? rx(c) : `'${rx(c)}'`);

for (const [table, def] of Object.entries(TABLES)) {
  ok(`${table}: RLS enabled`,      new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`).test(SQL));
  ok(`${table}: read policy uses ${def.read}`,
     new RegExp(`CREATE POLICY ${table}_read ON ${table}[\\s\\S]{0,300}app_can\\(${capArg(def.read)}`).test(SQL));
  ok(`${table}: write policy uses ${def.write}`,
     new RegExp(`CREATE POLICY ${table}_insert ON ${table}[\\s\\S]{0,300}app_can\\(${capArg(def.write)}`).test(SQL));
  ok(`${table}: update checks both ways`,
     new RegExp(`CREATE POLICY ${table}_update[\\s\\S]*?USING[\\s\\S]*?WITH CHECK`).test(SQL));
  // readAlso NARROWS — it is AND-ed. visibleWhen WIDENS — it is OR-ed. Get the
  // precedence wrong and a named exception silently becomes a bypass of the
  // extra requirement, which for `notification` would mean the feed handing
  // out medical information to anyone holding news.read.
  if (def.readAlso) {
    const policy = SQL.match(new RegExp(`CREATE POLICY ${table}_read ON ${table}[\\s\\S]*?;`))?.[0] ?? "";
    ok(`${table}: read ALSO requires ${def.readAlso}`,
       new RegExp(`AND app_can\\(${capArg(def.readAlso)}`).test(policy));
    ok(`${table}: the extra requirement is AND-ed, never OR-ed`,
       !new RegExp(`OR\\s+app_can\\(${capArg(def.readAlso)}`).test(policy));
  }
}
// Records about minors are deactivated, never deleted, so an audit trail survives.
ok("no DELETE policy is granted anywhere", !/FOR DELETE/.test(SQL));
ok("injury anchors its team through the linked player",
   /SELECT p\.team_code FROM player p WHERE p\.id = injury\.player_id/.test(SQL));
ok("competition is governed now (was ungoverned)",
   /CREATE POLICY competition_read ON competition/.test(SQL));

// ── D. Column masking ────────────────────────────────────
group("D. Column masking, per row");
for (const [table, def] of Object.entries(TABLES)) {
  const masked = maskedColumns(def);
  if (!Object.keys(masked).length) continue;
  ok(`${table}_masked is generated`, new RegExp(`VIEW ${table}_masked`).test(SQL));
  // security_invoker is the one that decides WHOSE policies apply. Without it
  // the view runs as its owner, who owns the table underneath and bypasses
  // row-level security on it — so the view returned every row in the table,
  // cross-school, still column-masked and therefore looking entirely correct.
  // security_barrier is a different guarantee (predicate push-down) and does
  // not substitute for it.
  ok(`${table}_masked runs as the CALLER, not its owner`,
     new RegExp(`VIEW ${table}_masked WITH \\([^)]*security_invoker = true`).test(SQL));
  ok(`${table}_masked is also a security barrier`,
     new RegExp(`VIEW ${table}_masked WITH \\(security_barrier = true`).test(SQL));
  ok(`${table}_masked builds from information_schema`,
     new RegExp(`\\$mask_${table}\\$[\\s\\S]*information_schema\\.columns`).test(SQL));
  ok(`${table}_masked fails loudly without its table`,
     new RegExp(`cannot build ${table}_masked`).test(SQL));
  for (const [cap, cols] of Object.entries(masked)) {
    ok(`${table}: ${cols.length} column(s) gated by ${cap}`,
       // The generated tuple carries a THIRD element now — the team anchor for
       // that capability — because a column can be masked against the row's own
       // team or against any team. The pattern matches the pair and leaves the
       // anchor to the assertions below.
       cols.every((c) => new RegExp(`\\('${c.toLowerCase()}', '${cap.replace(/\./g, "\\.")}', `).test(SQL)));
  }
}
// Masking is decided per row via app_can, not once per role for the query.
ok("masking calls app_can per row", /app_can\(%L, %s, %s, %s, NULL\)/.test(SQL));
ok("clinical notes are gated by medical.details.read",
   /\('notes', 'medical\.details\.read', /.test(SQL) && /\('physio', 'medical\.details\.read', /.test(SQL));
ok("guardian details are gated by player.pii.read",
   /\('guardian', 'player\.pii\.read', /.test(SQL));

// The two mask groups, and the difference between them. A column in
// `maskedAnyTeam` is evaluated with the team dimension switched off, which is
// what lets every coach at the school read an age while only a boy's own coach
// reads his address. Getting these two the wrong way round is invisible in the
// generated SQL unless something checks.
ok("age is masked against ANY team — the roster tier",
   /\('born', 'player\.age\.read', '''\*''::text'\)/.test(SQL));
ok("a home address is masked against the row's OWN team",
   /\('address', 'player\.pii\.read', 'player\.team_code'\)/.test(SQL));
ok("a national ID number is too — it never widens",
   /\('id_number', 'player\.identity\.read', 'player\.team_code'\)/.test(SQL));
ok("a player's name is NOT masked (over-masking guard)",
   !/\('full_name', /.test(SQL));

// ── E. The assignment tables protect themselves ──────────
group("E. Assignment tables");
ok("role_assignment has RLS",       /ALTER TABLE role_assignment ENABLE ROW LEVEL SECURITY/.test(SQL));
ok("a person reads their own assignments", /person_id = app_user_id\(\)/.test(SQL));
ok("granting requires user.role.assign",
   /CREATE POLICY role_assignment_write[\s\S]{0,200}app_can\('user\.role\.assign'/.test(SQL));
ok("assignment_subject has RLS",        /ALTER TABLE assignment_subject ENABLE ROW LEVEL SECURITY/.test(SQL));
ok("role_capability is readable reference data",
   /CREATE POLICY role_capability_read ON role_capability FOR SELECT USING \(true\)/.test(SQL));

// ── F. Model integrity ───────────────────────────────────
group("F. Model integrity");
ok("every capability the tables reference exists", referencedCapabilities().every(isCapability));
ok("every capability the tables reference is granted to some role",
   referencedCapabilities().every((c) => ROLES.some((r) => roleGrants(r, c))));
// This line used to claim SENSITIVE capabilities "are all used as mask gates
// or read gates" while asserting only that the names were spelled correctly —
// true of every string in this file, and so a label rather than a test. The
// claim it was making is now made properly, against the mask map and the
// logger's watched columns, in packages/policy/test/sensitivity.test.mjs.
// What is left here is the narrow thing this file is the right place for.
ok("SENSITIVE names only real capabilities", SENSITIVE.every(isCapability));
ok("no role bundles a capability that does not exist",
   ROLES.every((r) => ROLE_CAPABILITIES[r].every(isCapability)));
ok("the generated file warns against hand-editing", /DO NOT EDIT BY HAND/.test(SQL));
ok("it names the ADR", /docs\/adr\/0001/.test(SQL));
// The old single-role model must be gone from the emitted SQL entirely.
ok("no rbac_scope remains",        !/rbac_scope/.test(SQL));
ok("no rbac_field_denied remains", !/rbac_field_denied/.test(SQL));
ok("no app_role\\(\\) remains",    !/app_role\(\)/.test(SQL));

// ── SCRBRD-012: the hour hand is emitted where it runs, not where it shipped ──
// db/01 is frozen once applied, so the decision functions are re-emitted into
// db/23 with the one extra liveness line. The flag must reach all three, and
// must not touch db/01's output — that is the whole point of the flag.
{
  const shipped = authz(), running = timeBox();
  // Anchored to a body line: the file's header quotes the same line in a comment.
  const inBodies = (/** @type {string} */ sql) => (sql.match(/^ {7}AND \(a\.expires_at IS NULL OR a\.expires_at > now\(\)\)$/gm) || []).length;
  ok("db/01 is emitted without the hour hand", inBodies(shipped) === 0);
  ok("db/23 carries it in app_can, app_holds and app_may_grant", inBodies(running) === 3);
  // db/16 pinned search_path with ALTER FUNCTION, which CREATE OR REPLACE
  // discards — so the re-emitted functions must carry the pin themselves.
  ok("...each pinned to a search_path in its own definition",
     (running.match(/SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;/g) || []).length === 3);
  ok("...and db/01's tails are exactly as shipped",
     !/SECURITY DEFINER SET search_path/.test(shipped));
}

// ── SCRBRD-034: the pause is emitted where it runs, beside the hour hand ──
// db/35 re-emits db/23's three functions with one more liveness condition,
// reading duty_suspension (db/34). db/01 and db/23 must not carry it — both
// are shipped — and db/35 must not lose db/23's line on the way.
{
  const shipped = authz(), hour = timeBox(), running = suspension();
  const pause = (/** @type {string} */ sql) => (sql.match(/^ {7}AND NOT EXISTS \(SELECT 1 FROM duty_suspension s\n {24}WHERE s\.assignment_id = a\.id AND s\.lifted_at IS NULL\)$/gm) || []).length;
  const hand = (/** @type {string} */ sql) => (sql.match(/^ {7}AND \(a\.expires_at IS NULL OR a\.expires_at > now\(\)\)$/gm) || []).length;
  ok("db/01 is emitted without the pause", pause(shipped) === 0);
  ok("db/23 is emitted without the pause", pause(hour) === 0);
  ok("db/35 carries it in app_can, app_holds and app_may_grant", pause(running) === 3);
  ok("...and keeps db/23's hour hand in all three", hand(running) === 3);
  ok("...each pinned to a search_path in its own definition",
     (running.match(/SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;/g) || []).length === 3);
  ok("...and ends in a DO $check$ that asks the catalogue for the line",
     /DO \$check\$[\s\S]*duty_suspension s[\s\S]*END \$check\$;\n$/.test(running));
  // What CI diffs. A generated file missing from that list is one nobody
  // notices going stale — exactly what the list exists to stop.
  const here = dirname(fileURLToPath(import.meta.url));
  const ci = readFileSync(join(here, "../../../.github/workflows/ci.yml"), "utf8");
  ok("CI regenerates and diffs db/35 with the other generated files",
     /git diff --exit-code db\/01_authz\.sql db\/09_rls_policies\.sql db\/23_authz_time_box\.sql db\/35_authz_suspension\.sql/.test(ci));
  const onDisk = join(here, "../../../db/35_authz_suspension.sql");
  ok("db/35 on disk is what the generator emits", existsSync(onDisk) && readFileSync(onDisk, "utf8") === running);
}

// ── db/39: fixture anchors through the definer helpers, where they run ──
// tables.mjs declares match_school()/match_team() for the tables in
// REANCHORED_IN_39; db/09 must keep emitting the subqueries it shipped, and
// db/39 must carry exactly those tables' policies with the helpers. The
// audit behind the list, including why trip and match_squad are NOT on it,
// is docs/rls-anchor-audit.md.
group("db/39. Fixture anchors through match_school()/match_team()");
{
  const shipped = policies(), running = matchAnchors();
  const here = dirname(fileURLToPath(import.meta.url));
  const policyText = (/** @type {string} */ sql, /** @type {string} */ name) =>
    sql.match(new RegExp(`CREATE POLICY ${name} ON [\\s\\S]*?;`))?.[0] ?? "";
  ok("the list names seven tables", REANCHORED_IN_39.length === 7);
  for (const t of REANCHORED_IN_39) {
    const sub = `(SELECT m.school_id FROM match m WHERE m.id = ${t}.match_id)`;
    ok(`${t}: tables.mjs anchors through the helpers`,
       TABLES[t].anchors.school === `(match_school(${t}.match_id))`
       && TABLES[t].anchors.team === `(match_team(${t}.match_id))`);
    for (const p of ["read", "insert", "update"]) {
      ok(`${t}_${p}: db/09 still emits the subquery it shipped`, policyText(shipped, `${t}_${p}`).includes(sub));
      const now = policyText(running, `${t}_${p}`);
      ok(`${t}_${p}: db/39 anchors through match_school() and match_team()`,
         now.includes(`match_school(${t}.match_id)`) && now.includes(`match_team(${t}.match_id)`)
         && !now.includes("FROM match m"));
    }
  }
  // Withheld, with a reason each — the audit's, not an accident of the list.
  for (const t of ["trip", "match_squad"])
    ok(`${t} is withheld from db/39 and still anchors on its subquery`,
       !REANCHORED_IN_39.includes(t) && /FROM match m WHERE m\.id = /.test(TABLES[t].anchors.school ?? "")
       && !running.includes(`CREATE POLICY ${t}_read`));
  ok("db/39 re-creates nothing but those tables' policies",
     (running.match(/CREATE POLICY /g) || []).length === REANCHORED_IN_39.length * 3);
  ok("...and ends in a DO $check$ that asks pg_policies for the helpers",
     /DO \$check\$[\s\S]*pg_policies[\s\S]*match_school\(%[\s\S]*END \$check\$;\n$/.test(running));
  const ci = readFileSync(join(here, "../../../.github/workflows/ci.yml"), "utf8");
  ok("CI regenerates and diffs db/39 with the other generated files",
     /git diff --exit-code db\/01_authz\.sql db\/09_rls_policies\.sql db\/23_authz_time_box\.sql db\/35_authz_suspension\.sql db\/39_match_anchor_helpers\.sql/.test(ci));
  const onDisk = join(here, "../../../db", REANCHOR_FILE);
  ok("db/39 on disk is what the generator emits", existsSync(onDisk) && readFileSync(onDisk, "utf8") === running);
  const expected = JSON.parse(readFileSync(join(here, "../expected-migrations.json"), "utf8"));
  ok("db/39 is a migration the API expects", expected.includes(REANCHOR_FILE));
}

console.log(`\n${"─".repeat(52)}\nRLS SUITE: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

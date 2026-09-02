#!/usr/bin/env node
/**
 * Emits db/02_rls_policies.sql from the policy model. Never hand-edit the SQL;
 * change packages/policy/ and run `pnpm rls:generate`.
 *
 * What this emits
 * ───────────────
 *   1. role_capability rows            — the role→capability bundles
 *   2. app_can(...)                    — THE authorization decision, in SQL
 *   3. per-table RLS policies          — read/write, built on app_can
 *   4. *_masked views                  — per-row column masking, on app_can
 *
 * The decision is a SECURITY DEFINER lookup over role_assignment rather than
 * anything carried in the session. That is a deliberate choice (ADR 0001):
 * an assignment SET does not fit a session GUC the way a single role did, and
 * a lookup means revoking an assignment takes effect on the next statement
 * instead of at the person's next login. On a platform holding minors' data,
 * revocation latency is a safeguarding property, not a performance one.
 *
 * The function is STABLE, so Postgres evaluates it once per statement for a
 * given argument set rather than once per row.
 */

import { ROLE_CAPABILITIES, ROLES, roleGrants, SCORING_ROLES, unknownCapabilities } from "@scrbrd/policy/roles";
import { TABLES } from "@scrbrd/policy/tables";
import { ALL_CAPABILITIES } from "@scrbrd/policy/capabilities";

const q = (s) => `'${String(s).replaceAll("'", "''")}'`;
const banner = (t) => `\n-- ══════════════════════════════════════════════════════════════════\n--  ${t}\n-- ══════════════════════════════════════════════════════════════════`;

/** Scope anchor expression for a table column, or NULL when the table has none. */
/**
 * One scope argument to app_can(), in one of three states.
 *
 * The client model (authorize.mjs) has always had three; the SQL had two, and
 * that missing third state was a real bug rather than a tidiness point. A
 * guardian's assignment lists their children, so app_can() demands that the
 * resource name one of them — and a FIXTURE names no person at all, so every
 * guardian was denied every fixture. The guardian could not see when their own
 * child was playing.
 *
 *   named column  → the row states this dimension; compare it.
 *   ANY_SCOPE     → the dimension DOES NOT APPLY to this table (a fixture is
 *                   not about one person). The assignment's constraint on that
 *                   dimension is satisfied. Written by OMITTING the key.
 *   NULL          → the dimension applies but the row does not state it, so
 *                   nothing covers it. Fail closed. Written as an explicit
 *                   `null`, and used deliberately — `staff: { team: null }`
 *                   is how a coach is kept out of the staff directory.
 *
 * The sentinels mirror ANY_SCOPE in packages/policy/src/authorize.mjs: '*' for
 * the text dimension, the nil UUID for the uuid ones. A nil UUID is not a
 * legal id anywhere in the schema, so it cannot collide with a real row.
 */
const ANY = { uuid: "'00000000-0000-0000-0000-000000000000'::uuid", text: "'*'::text" };
const anchor = (table, def, key, cast) => {
  if (!(key in (def.anchors ?? {}))) return ANY[cast];   // dimension does not apply
  const col = def.anchors[key];
  if (!col) return `NULL::${cast}`;                       // stated as absent → narrows
  return col.startsWith("(") ? col : `${table}.${col}`;
};

const callCan = (table, def, capability) => {
  const args = [
    q(capability),
    anchor(table, def, "school", "uuid"),
    anchor(table, def, "team", "text"),
    anchor(table, def, "person", "uuid"),
    anchor(table, def, "fixture", "uuid"),
  ];
  return `app_can(${args.join(", ")})`;
};

function decisionFunction() {
  return `${banner("The authorization decision")}
-- app_can(capability, school, team, person, fixture)
--
-- TRUE when ONE SINGLE assignment held by the current user both grants the
-- capability and covers the resource. Never a union across assignments: a
-- capability held through one assignment is only ever applied within that
-- same assignment's scope.
--
-- Scope semantics, which are asymmetric on purpose:
--   NULL on the ASSIGNMENT widens  — school_id NULL is platform-wide,
--                                    team_code NULL is every team in the school.
--   NULL on the RESOURCE narrows   — a row that does not state its school is
--                                    NOT covered by a school-scoped assignment.
-- The second half is what makes a query that forgot its scope fail closed
-- instead of matching everything.
--
-- The third state is ANY_SCOPE ('*' for team, the nil UUID for the others),
-- meaning the dimension DOES NOT APPLY to this kind of row. A fixture is not
-- about one person, so a guardian assignment's child list has nothing to
-- constrain and does not constrain it. Without this, every guardian was denied
-- every fixture — they could not see when their own child was playing. It is
-- passed by the generator only for dimensions a table omits entirely; a table
-- that states a dimension as absent still narrows.
--
-- SECURITY DEFINER because role_assignment is itself RLS-protected: a person
-- may not read other people's assignments, but the decision must read their
-- own. STABLE so it is evaluated once per statement per argument set.
CREATE OR REPLACE FUNCTION app_can(
  p_capability text,
  p_school     uuid DEFAULT NULL,
  p_team       text DEFAULT NULL,
  p_person     uuid DEFAULT NULL,
  p_fixture    uuid DEFAULT NULL
) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1
      FROM role_assignment a
      JOIN role_capability rc
        ON rc.role = a.role
       AND rc.capability = p_capability
     WHERE a.person_id = app_user_id()
       AND a.active
       AND (a.valid_from  IS NULL OR a.valid_from  <= current_date)
       AND (a.valid_until IS NULL OR a.valid_until >  current_date)
       -- institution. There is no ANY_SCOPE for school: every governed row
       -- belongs to a tenant, and one that does not state its tenant is one
       -- nobody should reach.
       AND (a.school_id IS NULL OR (p_school IS NOT NULL AND a.school_id = p_school))
       -- team
       AND (a.team_code IS NULL OR p_team = ${ANY.text}
            OR (p_team IS NOT NULL AND a.team_code = p_team))
       -- single fixture (scorers, match officials)
       AND (a.fixture_id IS NULL OR p_fixture = ${ANY.uuid}
            OR (p_fixture IS NOT NULL AND a.fixture_id = p_fixture))
       -- guardian: an assignment listing children reaches ONLY those children
       AND (
         NOT EXISTS (SELECT 1 FROM guardian_child g WHERE g.assignment_id = a.id)
         OR p_person = ${ANY.uuid}
         OR (p_person IS NOT NULL AND EXISTS (
               SELECT 1 FROM guardian_child g
                WHERE g.assignment_id = a.id AND g.player_id = p_person))
       )
  )
$$ LANGUAGE sql STABLE SECURITY DEFINER;

REVOKE ALL ON FUNCTION app_can(text, uuid, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_can(text, uuid, text, uuid, uuid) TO PUBLIC;

-- There is deliberately NO can_score(role) here. It existed, it was correct,
-- and nothing called it after the scoring policies moved to app_can() — which
-- makes it worse than useless: a role-shaped decision function sitting in the
-- schema is an invitation to reach for it, and reaching for it reintroduces
-- the exact hole ADR 0001 closed (a role the session asserts, evaluated
-- without a scope). Scoring authority is app_can('scoring.edit', ...) against
-- the assignments the database looks up, and there is no second way to ask.`;
}

function capabilityRows() {
  const rows = [];
  for (const role of ROLES)
    for (const cap of ROLE_CAPABILITIES[role]) rows.push(`  (${q(role)}, ${q(cap)})`);
  return `${banner("Role → capability bundles")}
-- Replaced wholesale on every regeneration.
DELETE FROM role_capability;
INSERT INTO role_capability (role, capability) VALUES
${rows.join(",\n")};`;
}

/**
 * The SELECT predicate: the capability check, plus any named exception.
 *
 * `visibleWhen` is an explicit escape hatch and is meant to be conspicuous.
 * It exists because two rows are legitimately readable outside the capability
 * model — your own user record, and the schools you are attached to — and the
 * alternative was leaving those tables with row-level security switched off
 * entirely, which is what was happening. Each one is written out in the
 * generated SQL with its reason attached, so a reviewer reads the exception
 * rather than discovering the absence.
 */
const readPredicate = (table, def) => {
  const can = callCan(table, def, def.read);
  if (!def.visibleWhen) return can;
  return `${can}\n    OR (${def.visibleWhen.trim()})`;
};

function tablePolicies() {
  const out = [banner("Per-table row-level security")];
  for (const [table, def] of Object.entries(TABLES)) {
    out.push(`
-- ${table} — read: ${def.read} · write: ${def.write}${def.visibleWhen ? "\n-- plus a named exception on read — see readPredicate() in generate-rls.mjs" : ""}
ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ${table}_read   ON ${table};
DROP POLICY IF EXISTS ${table}_insert ON ${table};
DROP POLICY IF EXISTS ${table}_update ON ${table};
DROP POLICY IF EXISTS ${table}_delete ON ${table};

CREATE POLICY ${table}_read ON ${table}
  FOR SELECT USING (${readPredicate(table, def)});

CREATE POLICY ${table}_insert ON ${table}
  FOR INSERT WITH CHECK (${callCan(table, def, def.write)});

CREATE POLICY ${table}_update ON ${table}
  FOR UPDATE USING (${callCan(table, def, def.write)})
           WITH CHECK (${callCan(table, def, def.write)});`);
    // No DELETE policy anywhere: records about minors are deactivated, never
    // removed, so that an audit trail survives.
  }
  return out.join("\n");
}

function maskViews() {
  const out = [banner("Column-masking views")];
  for (const [table, def] of Object.entries(TABLES)) {
    const masked = def.masked ?? {};
    if (!Object.keys(masked).length) continue;

    // column → guarding capability
    const guard = {};
    for (const [cap, cols] of Object.entries(masked))
      for (const c of cols) guard[c.toLowerCase()] = cap;

    const pairs = Object.entries(guard)
      .map(([col, cap]) => `(${q(col)}, ${q(cap)})`)
      .join(", ");

    out.push(`
-- ${table}_masked — every column listed explicitly, each sensitive one gated
-- by its own capability and evaluated PER ROW.
--
-- Built from information_schema rather than written as \`SELECT t.*, CASE …\`:
-- Postgres rejects a view with a duplicated output column name, so the shorter
-- form never applied at all. Introspecting also means adding a column to the
-- table surfaces it here automatically, masked if the policy names it.
DO $mask_${table}$
DECLARE cols text;
BEGIN
  SELECT string_agg(
           CASE WHEN g.capability IS NOT NULL
                THEN format('CASE WHEN app_can(%L, %s, %s, %s, NULL) THEN %I ELSE NULL END AS %I',
                            g.capability,
                            ${q(anchor(table, def, "school", "uuid"))},
                            ${q(anchor(table, def, "team", "text"))},
                            ${q(anchor(table, def, "person", "uuid"))},
                            c.column_name, c.column_name)
                ELSE format('%I', c.column_name)
           END, ', ' ORDER BY c.ordinal_position)
    INTO cols
    FROM information_schema.columns c
    LEFT JOIN (VALUES ${pairs}) AS g(column_name, capability)
           ON g.column_name = c.column_name
   WHERE c.table_schema = 'public' AND c.table_name = ${q(table)};

  IF cols IS NULL THEN
    RAISE EXCEPTION 'cannot build ${table}_masked: table ${table} not found (apply 00_schema_core.sql first)';
  END IF;

  EXECUTE format(
    'CREATE OR REPLACE VIEW ${table}_masked WITH (security_barrier = true) AS SELECT %s FROM ${table}',
    cols);
END
$mask_${table}$;`);
  }
  return out.join("\n");
}

function assignmentPolicies() {
  return `${banner("The assignment tables themselves")}
-- A person may read their own assignments — the context switcher needs them —
-- and nobody else's. Granting and revoking goes through user.role.assign.
ALTER TABLE role_assignment ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS role_assignment_read  ON role_assignment;
DROP POLICY IF EXISTS role_assignment_write ON role_assignment;

CREATE POLICY role_assignment_read ON role_assignment
  FOR SELECT USING (
    person_id = app_user_id()
    OR app_can('user.role.assign', school_id, team_code, NULL, NULL)
  );
CREATE POLICY role_assignment_write ON role_assignment
  FOR INSERT WITH CHECK (app_can('user.role.assign', school_id, team_code, NULL, NULL));

ALTER TABLE guardian_child ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS guardian_child_read ON guardian_child;
CREATE POLICY guardian_child_read ON guardian_child
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM role_assignment a
     WHERE a.id = guardian_child.assignment_id
       AND (a.person_id = app_user_id()
            OR app_can('user.role.assign', a.school_id, a.team_code, NULL, NULL))
  ));

-- role_capability is generated reference data, readable by all, written only
-- by the generator running as the migration user.
ALTER TABLE role_capability ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS role_capability_read ON role_capability;
CREATE POLICY role_capability_read ON role_capability FOR SELECT USING (true);`;
}

/**
 * The authorization half — principal helpers, the decision function, and the
 * role→capability rows.
 *
 * Emitted SEPARATELY and applied FIRST, because the scoring policies in
 * db/02 reference app_can(). A single generated file could not satisfy both
 * orders: the tables the policies attach to must exist before the policies,
 * and the decision function must exist before anything references it.
 */
export function authz() {
  const bad = unknownCapabilities();
  if (bad.length) {
    console.error("Roles name capabilities that do not exist:\n  " + bad.join("\n  "));
    process.exit(1);
  }
  return [
    `-- SCRBRD — authorization: the decision function and the role bundles`,
    `-- GENERATED from packages/policy/ by services/api/rls/generate-rls.mjs — DO NOT EDIT BY HAND.`,
    `-- Regenerate with \`pnpm rls:generate\`. Applied BEFORE the scoring schema,`,
    `-- which references app_can(). Model: docs/adr/0001-scoped-assignments.md.`,
    `-- ${ALL_CAPABILITIES.length} capabilities across ${ROLES.length} roles.`,
    ``,
    `-- Principal helpers. app_user_id() is set from the signed token on every`,
    `-- request; everything else about a person's authority is looked up.`,
    `CREATE OR REPLACE FUNCTION app_user_id() RETURNS uuid AS $$`,
    `  SELECT nullif(current_setting('app.user_id', true), '')::uuid $$ LANGUAGE sql STABLE;`,
    `CREATE OR REPLACE FUNCTION app_device_id() RETURNS text AS $$`,
    `  SELECT nullif(current_setting('app.device_id', true), '') $$ LANGUAGE sql STABLE;`,
    `CREATE OR REPLACE FUNCTION app_player_id() RETURNS uuid AS $$`,
    `  SELECT nullif(current_setting('app.player_id', true), '')::uuid $$ LANGUAGE sql STABLE;`,
    decisionFunction(),
    capabilityRows(),
    assignmentPolicies(),
    ``,
  ].join("\n");
}

/** The table policies and masking views. Applied after the tables exist. */
export function policies() {
  return [
    `-- SCRBRD — Row-Level Security & column masking`,
    `-- GENERATED from packages/policy/ by services/api/rls/generate-rls.mjs — DO NOT EDIT BY HAND.`,
    `-- Regenerate with \`pnpm rls:generate\`. Companion: db/01_authz.sql.`,
    `-- Model: capability + scoped assignment (docs/adr/0001-scoped-assignments.md).`,
    `-- Roles that may score: ${SCORING_ROLES.join(", ")}`,
    tablePolicies(),
    maskViews(),
    ``,
  ].join("\n");
}

/** Backwards-compatible single string, for the drift tests. */
export function main() { return authz() + "\n" + policies(); }

if (import.meta.url === `file://${process.argv[1]}`) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync("db/01_authz.sql", authz());
  writeFileSync("db/03_rls_policies.sql", policies());
  console.log("wrote db/01_authz.sql and db/03_rls_policies.sql");
}

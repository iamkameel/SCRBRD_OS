/**
 * SCRBRD — RLS generator
 *
 * Emits rls_policies.sql from policy.mjs. Never hand-edit the SQL; change the
 * policy and regenerate. Run:  node rls/generate-rls.mjs > rls/rls_policies.sql
 *
 * What it generates:
 *   1. rbac_scope(role, resource)      — effective scope, from POLICY
 *   2. rbac_can_read(resource, school, team, owner) — row visibility (mirrors inScope)
 *   3. rbac_can_write(resource, action)             — capability for writes
 *   4. rbac_field_denied(resource, field)           — column mask decision
 *   5. per-table RLS SELECT/INSERT/UPDATE policies
 *   6. masking VIEWS that null denied columns per role
 *
 * IMPORTANT — the RLS ÷ column split:
 *   Postgres RLS is ROW-level. Field/PII stripping is COLUMN-level and cannot be
 *   done by RLS with a single app role + session vars. So row visibility is RLS;
 *   column masking is done by the generated *_masked views. The API must read
 *   PII/clinical tables THROUGH those views, never the base tables.
 */
import { POLICY, ROLES, RESOURCE_TABLES, decide, canScore, maskableFields, SCOPE_RANK } from "./policy.mjs";

const q = s => `'${s.replace(/'/g, "''")}'`;
const banner = t => `-- ${"═".repeat(66)}\n--  ${t}\n-- ${"═".repeat(66)}`;

function scopeFn() {
  // rbac_scope(role,resource) → effective scope string, straight from POLICY.
  const lines = [];
  for (const role of ROLES) {
    for (const resource of new Set(Object.values(RESOURCE_TABLES).map(t => t.resource))) {
      const d = decide(role, resource, "r");
      const scope = d.allowed ? d.scope : "none";
      lines.push(`    WHEN p_role = ${q(role)} AND p_resource = ${q(resource)} THEN ${q(scope)}`);
    }
  }
  return `CREATE OR REPLACE FUNCTION rbac_scope(p_role text, p_resource text)
RETURNS text AS $$
  SELECT CASE
    WHEN p_role = 'superadmin' THEN 'all'
${lines.join("\n")}
    ELSE 'none'
  END
$$ LANGUAGE sql IMMUTABLE;`;
}

function canReadFn() {
  // Faithful SQL mirror of the app's inScope(): all|school|team|own|none.
  return `CREATE OR REPLACE FUNCTION rbac_can_read(
  p_resource text, p_school uuid, p_team text, p_owner uuid)
RETURNS boolean AS $$
DECLARE v_scope text := rbac_scope(app_role(), p_resource);
BEGIN
  RETURN CASE v_scope
    WHEN 'all'    THEN true
    WHEN 'school' THEN p_school = app_school_id()
    WHEN 'team'   THEN p_team = ANY(app_teams())
    WHEN 'own'    THEN p_owner = app_player_id() OR p_owner = ANY(app_child_ids())
    ELSE false
  END;
END $$ LANGUAGE plpgsql STABLE;`;
}

function canWriteFn() {
  // Capability (create/update/delete) per role+resource, from POLICY `can`.
  const lines = [];
  for (const role of ROLES) {
    for (const resource of new Set(Object.values(RESOURCE_TABLES).map(t => t.resource))) {
      for (const action of ["create", "update", "delete"]) {
        const d = decide(role, resource, action);
        if (d.allowed) lines.push(`    WHEN app_role() = ${q(role)} AND p_resource = ${q(resource)} AND p_action = ${q(action)} THEN true`);
      }
    }
  }
  return `CREATE OR REPLACE FUNCTION rbac_can_write(p_resource text, p_action text)
RETURNS boolean AS $$
  SELECT CASE
    WHEN app_role() = 'superadmin' THEN true
${lines.join("\n")}
    ELSE false
  END
$$ LANGUAGE sql STABLE;`;
}

function fieldDeniedFn() {
  // rbac_field_denied(resource,field) for the CURRENT role — drives masking.
  const lines = [];
  for (const role of ROLES) {
    for (const { resource } of Object.values(RESOURCE_TABLES)) {
      for (const field of maskableFields(resource)) {
        if (decide(role, resource, "r").deny.includes(field))
          lines.push(`    WHEN app_role() = ${q(role)} AND p_resource = ${q(resource)} AND p_field = ${q(field)} THEN true`);
      }
    }
  }
  return `CREATE OR REPLACE FUNCTION rbac_field_denied(p_resource text, p_field text)
RETURNS boolean AS $$
  SELECT CASE
${lines.join("\n") || "    WHEN false THEN true"}
    ELSE false
  END
$$ LANGUAGE sql STABLE;`;
}

function sessionHelpers() {
  return `-- Principal helpers (set from the JWT on every request via set_config).
-- app_user_id / app_role / app_school_id already exist in schema_scoring.sql.
CREATE OR REPLACE FUNCTION app_player_id() RETURNS uuid AS $$
  SELECT nullif(current_setting('app.player_id', true), '')::uuid $$ LANGUAGE sql STABLE;
CREATE OR REPLACE FUNCTION app_child_ids() RETURNS uuid[] AS $$
  SELECT coalesce(string_to_array(nullif(current_setting('app.child_ids', true), ''), ',')::uuid[], '{}') $$ LANGUAGE sql STABLE;
CREATE OR REPLACE FUNCTION app_teams() RETURNS text[] AS $$
  SELECT coalesce(string_to_array(nullif(current_setting('app.teams', true), ''), ','), '{}') $$ LANGUAGE sql STABLE;`;
}

function tablePolicies(table, def) {
  const { resource, school, team, owner } = def;
  const teamExpr  = team  ? team  : "NULL::text";
  const ownerExpr = owner ? owner : "NULL::uuid";

  // For injuries the team/school anchors come from the linked player.
  const injuryNote = table === "injury"
    ? `\n-- injury row anchors resolve through the linked player (team + school).`
    : "";
  const schoolExpr = school;
  const teamAnchor = table === "injury"
    ? `(SELECT team_code FROM player WHERE player.id = injury.player_id)`
    : teamExpr;

  const read = `CREATE POLICY ${table}_rbac_read ON ${table}
  FOR SELECT USING (
    rbac_can_read(${q(resource)}, ${schoolExpr}, ${teamAnchor}, ${ownerExpr})
  );`;

  // Writes: capability + confined to the caller's school (conservative).
  const canIns = ROLES.some(r => decide(r, resource, "create").allowed);
  const canUpd = ROLES.some(r => decide(r, resource, "update").allowed);
  const writes = [];
  if (canIns) writes.push(`CREATE POLICY ${table}_rbac_insert ON ${table}
  FOR INSERT WITH CHECK (
    rbac_can_write(${q(resource)}, 'create') AND ${schoolExpr} = app_school_id()
  );`);
  if (canUpd) writes.push(`CREATE POLICY ${table}_rbac_update ON ${table}
  FOR UPDATE USING (
    rbac_can_write(${q(resource)}, 'update')
    AND rbac_can_read(${q(resource)}, ${schoolExpr}, ${teamAnchor}, ${ownerExpr})
  );`);

  return `-- ${table} (lens: ${resource})${injuryNote}
ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;
${read}
${writes.join("\n")}`;
}

function maskView(table, def) {
  // Build a *_masked view that nulls any column a role may not see.
  //
  // Columns come from the union of all resources' maskable fields for this
  // table, intersected with the columns the table physically carries — a policy
  // may deny a field group the table does not hold (see RESOURCE_TABLES.columns).
  const present = new Set(def.columns ?? []);
  const fields = [...new Set(def.mask.flatMap(maskableFields))].filter(f => present.has(f));
  if (!fields.length) return null;
  const lens = def.mask[0]; // primary lens for the mask decision

  // The view is assembled at migration time from information_schema rather
  // than written as `SELECT t.*, CASE … AS email`. That shorter form does not
  // work: Postgres rejects a view with a duplicated output column name
  // ("column \"email\" specified more than once"), so re-projecting a masked
  // column after `*` never applied at all. Introspecting also means adding a
  // column to the table does not require regenerating this file — the column
  // appears in the view automatically, masked if the policy denies it.
  const denied = fields.map(f => f.toLowerCase());
  return `-- Read ${table} through this view; base-table PII is masked per role.
-- Assembled from information_schema so every column is listed explicitly.
DO $mask_${table}$
DECLARE cols text;
BEGIN
  SELECT string_agg(
           CASE WHEN c.column_name = ANY (ARRAY[${denied.map(q).join(", ")}])
                THEN format('CASE WHEN rbac_field_denied(%L, %L) THEN NULL ELSE %I END AS %I',
                            ${q(lens)}, c.column_name, c.column_name, c.column_name)
                ELSE format('%I', c.column_name)
           END, ', ' ORDER BY c.ordinal_position)
    INTO cols
    FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.table_name = ${q(table)};

  IF cols IS NULL THEN
    RAISE EXCEPTION 'cannot build ${table}_masked: table ${table} not found (apply 00_schema_core.sql first)';
  END IF;

  EXECUTE format(
    'CREATE OR REPLACE VIEW ${table}_masked WITH (security_barrier = true) AS SELECT %s FROM ${table}',
    cols);
END
$mask_${table}$;`;
}

function main() {
  const out = [];
  out.push(`-- SCRBRD — Row-Level Security & column masking`);
  out.push(`-- GENERATED from rls/policy.mjs by rls/generate-rls.mjs — DO NOT EDIT BY HAND.`);
  out.push(`-- Regenerate after any policy change. Companion: schema_scoring.sql.\n`);
  out.push(banner("Session principal helpers"));
  out.push(sessionHelpers(), "");
  out.push(banner("Policy functions (derived from POLICY)"));
  out.push(scopeFn(), "", canReadFn(), "", canWriteFn(), "", fieldDeniedFn(), "");
  out.push(banner("Per-table RLS policies"));
  for (const [table, def] of Object.entries(RESOURCE_TABLES)) out.push(tablePolicies(table, def), "");
  out.push(banner("Column-masking views (field/PII deny)"));
  for (const [table, def] of Object.entries(RESOURCE_TABLES)) {
    const v = maskView(table, def);
    if (v) out.push(v, "");
  }
  out.push(banner("Scoring capability (mirrors canScore) — used by ball_event policies in schema_scoring.sql"));
  out.push(`-- Roles that may score: ${ROLES.filter(canScore).concat("superadmin").filter((v,i,a)=>a.indexOf(v)===i).join(", ")}`);
  return out.join("\n");
}

// ESM entrypoint
const sql = main();
if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write(sql + "\n");
export { main };

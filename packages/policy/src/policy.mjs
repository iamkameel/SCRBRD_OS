/**
 * SCRBRD — RBAC policy (single source of truth)
 *
 * This is the ONE definition of "who may read/write what, at what scope, with
 * which fields hidden." Both surfaces derive from it:
 *   - the client   → canScore() / can() / getData()   (already in the app)
 *   - the database → rls_policies.sql                  (generated, never hand-edited)
 *
 * The artifact has now graduated to a repo, so the intended end state is in
 * force: there is literally one copy. The web app imports this module via
 * `@scrbrd/policy`; the database generator imports it through the shim at
 * services/api/rls/policy.mjs. Nothing inlines a second POLICY object, and
 * rls.test.mjs re-derives every app assertion from this file to keep it so.
 */

// Sensitive field groups — expanded wherever a policy `deny` names them.
export const FIELDS = {
  pii:      ["email","phone","born","hometown","houseAtSchool","address","guardian","height","weight"],
  clinical: ["notes","physio"],
};

export const SCOPE_RANK = { none: 0, own: 1, team: 2, school: 3, all: 4 };

// role → { can, scope, only?, scopes?, deny? }
//   can    : allowed actions, subset of "crud"
//   scope  : default row scope (all|school|team|own|none)
//   only   : resource whitelist (omit ⇒ every resource)
//   scopes : per-resource scope overrides
//   deny   : per-resource ("*" = all) field groups/fields to strip
export const POLICY = {
  superadmin:      { can: "crud", scope: "all" },
  platformsupport: { can: "r",    scope: "all",    deny: { "*": ["pii"], injuries: ["clinical"] } },
  headmaster:      { can: "ru",   scope: "school", deny: { injuries: ["clinical"] } },
  sportsmaster:    { can: "crud", scope: "school", only: ["dashboard","matches","competitions","leagues","squad","players","profiles","analytics","injuries","skills","training","logistics","fields","staff","calendar","management","notifications","settings","rulebook","scoring"], deny: { injuries: ["clinical"] } },
  schooladmin:     { can: "crud", scope: "school", only: ["dashboard","matches","competitions","squad","players","profiles","analytics","injuries","logistics","fields","staff","calendar","management","notifications","settings"], deny: { injuries: ["clinical"] } },
  financeadmin:    { can: "crud", scope: "school", only: ["dashboard","profiles","finance","calendar","management","notifications","settings"], deny: { profiles: ["born","houseAtSchool","height","weight","guardian"] } },
  headcoach:       { can: "crud", scope: "school", only: ["dashboard","matches","competitions","leagues","squad","players","profiles","analytics","skills","training","injuries","logistics","fields","calendar","management","notifications","scoring"] },
  coach:           { can: "cru",  scope: "team",   only: ["dashboard","matches","squad","players","profiles","analytics","skills","training","injuries","logistics","fields","calendar","management","notifications","scoring"] },
  assistant:       { can: "ru",   scope: "team",   only: ["dashboard","matches","squad","players","profiles","skills","training","injuries","calendar","notifications","scoring"], deny: { injuries: ["clinical"] } },
  analyst:         { can: "r",    scope: "school", only: ["dashboard","matches","competitions","leagues","squad","players","profiles","analytics","skills","calendar"], deny: { "*": ["pii"] } },
  scorer:          { can: "cru",  scope: "team",   only: ["dashboard","matches","calendar","notifications","scoring"] },
  medical:         { can: "crud", scope: "school", only: ["dashboard","injuries","players","profiles","training","squad","calendar","notifications"] },
  groundskeeper:   { can: "ru",   scope: "school", only: ["dashboard","fields","matches","calendar","notifications","management"] },
  driver:          { can: "r",    scope: "school", only: ["dashboard","logistics","matches","calendar","notifications"] },
  player:          { can: "r",    scope: "own",    only: ["dashboard","matches","profiles","analytics","skills","training","injuries","calendar","notifications"] },
  parent:          { can: "r",    scope: "own",    only: ["dashboard","matches","competitions","profiles","injuries","logistics","calendar","notifications"],
                     scopes: { matches: "school", competitions: "school", leagues: "school", calendar: "school", logistics: "team" } },
  spectator:       { can: "r",    scope: "school", only: ["dashboard","matches","competitions","leagues","analytics","calendar"], deny: { "*": ["pii"] } },
};

export const ROLES = Object.keys(POLICY);

/**
 * Physical tables that carry security weight, and how each row's scope anchors
 * (school / team / owner) are obtained. `resource` is the POLICY lens applied.
 * Resources without a table (dashboard, analytics, settings, …) are API/derived
 * and are enforced at the query layer, not by RLS — listed in NON_TABLE below.
 */
// `columns` lists the sensitive columns that physically exist on the table. A
// policy may name a field group that a given table does not carry — `injuries`
// denies the whole `pii` group because analysts and spectators must never see
// PII anywhere, but an injury row holds no PII of its own: it links to a
// player. Without this intersection the generator would emit a masking view
// referencing columns that do not exist, and the migration would fail to apply.
// Keeping PII off the injury table is also the POPIA-correct modelling — a
// clinical record should not duplicate a minor's guardian details.
export const RESOURCE_TABLES = {
  player:  { resource: "players",  school: "school_id", team: "team_code", owner: "id",         mask: ["players","profiles"],
             columns: ["email","phone","born","hometown","houseAtSchool","address","guardian","height","weight"] },
  coach:   { resource: "profiles", school: "school_id", team: "team_code", owner: "id",         mask: ["profiles"],
             columns: ["email","phone","born","hometown","address"] },
  staff:   { resource: "profiles", school: "school_id", team: null,        owner: "id",         mask: ["profiles"],
             columns: ["email","phone","born","hometown","address"] },
  injury:  { resource: "injuries", school: "school_id", team: "player_team",owner: "player_id", mask: ["injuries"],
             columns: ["notes","physio"] },
  match:   { resource: "matches",  school: "school_id", team: "team_code", owner: null,          mask: [], columns: [] },
};

export const NON_TABLE = ["dashboard","analytics","settings","management","rulebook","finance","logistics","fields","calendar","notifications","competitions","leagues","squad","skills","training","scoring"];

// ── The decision brain (identical semantics to the app's can()) ──
function expandDeny(deny, resource) {
  if (!deny) return [];
  const groups = [...(deny["*"] || []), ...(deny[resource] || [])];
  return groups.flatMap(g => FIELDS[g] || [g]);
}

/** Effective decision for (role, resource, action). Mirrors app can(). */
export function decide(role, resource, action = "r") {
  if (role === "superadmin") return { allowed: true, scope: "all", deny: [] };
  const p = POLICY[role];
  if (!p) return { allowed: false, scope: "none", deny: [] };
  if (p.only && !p.only.includes(resource)) return { allowed: false, scope: "none", deny: [] };
  if (!p.can.includes(action[0])) return { allowed: false, scope: p.scope, deny: [] };
  const scope = (p.scopes && p.scopes[resource]) || p.scope || "none";
  return { allowed: true, scope, deny: expandDeny(p.deny, resource) };
}

/** Live-scoring capability (mirrors app canScore()). */
export function canScore(role) {
  if (role === "superadmin") return true;
  const p = POLICY[role];
  return !!(p && p.only && p.only.includes("scoring") && /[cu]/.test(p.can));
}

/** Is `field` hidden for `role` when reading `resource`? (mirrors rbacStrip) */
export function fieldDenied(role, resource, field) {
  return decide(role, resource, "r").deny.includes(field);
}

/** All fields any policy can hide, per resource — drives mask view columns. */
export function maskableFields(resource) {
  const set = new Set();
  for (const role of ROLES)
    for (const f of decide(role, resource, "r").deny) set.add(f);
  return [...set];
}

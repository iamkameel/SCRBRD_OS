/**
 * SCRBRD — the client's access layer, and the single choke point for data.
 *
 * Every view reads through `getData()` / `filterRecord()`. Nothing reaches
 * around them to touch a mock constant directly — a view that renders
 * correctly while bypassing this file is a defect regardless of how it looks,
 * because it has skipped both the row scoping and the field masking that
 * POPIA requires of a platform whose data subjects are children.
 *
 * The decision itself is NOT made here. It is `authorize()` in
 * `@scrbrd/policy`, the same module the database's RLS is generated from, so
 * the client and Postgres cannot disagree. This file only:
 *
 *   1. maps the legacy resource names the 19 views use onto capabilities
 *   2. builds a demo principal from the role switcher
 *   3. applies the decision to the mock data
 *
 * When the backend lands, (3) becomes an authenticated call to read-api and
 * NOTHING ELSE CHANGES — the views already read through here, so row scoping
 * and column masking stay enforced in one place rather than re-implemented on
 * nineteen screens.
 */

import { authorize, scopeFilter } from "@scrbrd/policy/authorize";
import { roleGrants, ROLE_CAPABILITIES } from "@scrbrd/policy/roles";
import { TABLES } from "@scrbrd/policy/tables";
import { COACHES, COMPETITIONS, INJURIES, MATCHES, PLAYERS, STAFF } from "../data/mock.js";

// ── Legacy resource names → capabilities ────────────────
// The views speak in resources ("injuries", "players"); the model speaks in
// capabilities. This table is the only place the two meet, and it is small on
// purpose — a new screen names an existing capability rather than inventing a
// resource.
const RESOURCE = {
  players:      { table: "player",      r: "player.profile.read",  c: "player.profile.manage", u: "player.profile.manage", d: "player.profile.manage" },
  profiles:     { table: "coach",       r: "user.read",            c: "user.invite",           u: "user.role.assign",      d: "user.role.assign" },
  staff:        { table: "staff",       r: "user.read",            c: "user.invite",           u: "user.role.assign",      d: "user.role.assign" },
  // Reading an injury is reading AVAILABILITY. The diagnosis is masked below,
  // behind medical.details.read.
  injuries:     { table: "injury",      r: "medical.status.read",  c: "medical.write",         u: "medical.write",         d: "medical.write" },
  matches:      { table: "match",       r: "fixture.read",         c: "fixture.create",        u: "fixture.update",        d: "fixture.cancel" },
  competitions: { table: "competition", r: "competition.read",     c: "competition.manage",    u: "competition.manage",    d: "competition.manage" },
  scoring:      { table: null,          r: "fixture.read",         c: "scoring.edit",          u: "scoring.edit",          d: "scoring.finalise" },
  analytics:    { table: null,          r: "analytics.read",       c: null,                    u: null,                    d: null },
  logistics:    { table: null,          r: "transport.read",       c: "transport.manage",      u: "transport.manage",      d: "transport.manage" },
  fields:       { table: null,          r: "facility.read",        c: "facility.manage",       u: "facility.manage",       d: "facility.manage" },
  finance:      { table: null,          r: "invoice.read",         c: "invoice.manage",        u: "invoice.manage",        d: "invoice.manage" },
};

const ACTION = { r: "r", read: "r", c: "c", create: "c", u: "u", update: "u", d: "d", delete: "d" };

/** field → the capability required to see it, for a legacy resource. */
function maskMap(resource) {
  const def = RESOURCE[resource];
  const table = def?.table ? TABLES[def.table] : null;
  const out = {};
  for (const [cap, cols] of Object.entries(table?.masked ?? {}))
    for (const col of cols) out[col] = cap;
  // The mock data uses camelCase where the table uses lowercase.
  if (out.houseatschool) out.houseAtSchool = out.houseatschool;
  return out;
}

// ── The demo principal ──────────────────────────────────
/**
 * The role switcher still speaks the pre-migration role names. This maps each
 * to a role in the current model plus a scope, so the demo keeps working while
 * authorization runs on assignments.
 *
 * Three of these are judgement calls rather than renames, and are flagged in
 * docs/adr/0001:
 *
 *   superadmin      → platformadmin. Under the new model NOBODY sees
 *                     everything: operating the platform does not grant
 *                     access to a school's medical or disciplinary records.
 *                     The demo's default role therefore shows LESS than it
 *                     used to. That is the intended behaviour, not a
 *                     regression — but it is the most visible change here.
 *   headcoach       → coach with the team widened to the whole school.
 *   platformsupport → platformadmin; the distinction now lives in whether
 *                     platform.support.impersonate has been exercised.
 */
const DEMO_SCHOOL = "HIL";
const DEMO_TEAM = "U19A";
const DEMO_CHILD = "p5";

const LEGACY_ROLE = {
  superadmin:      { role: "platformadmin",        school: null },
  platformsupport: { role: "platformadmin",        school: null },
  headmaster:      { role: "principal",            school: DEMO_SCHOOL },
  sportsmaster:    { role: "directorofsport",      school: DEMO_SCHOOL },
  schooladmin:     { role: "schooladmin",          school: DEMO_SCHOOL },
  financeadmin:    { role: "finance",              school: DEMO_SCHOOL },
  headcoach:       { role: "coach",                school: DEMO_SCHOOL },
  coach:           { role: "coach",                school: DEMO_SCHOOL, team: DEMO_TEAM },
  assistant:       { role: "assistantcoach",       school: DEMO_SCHOOL, team: DEMO_TEAM },
  analyst:         { role: "analyst",              school: DEMO_SCHOOL },
  scorer:          { role: "scorer",               school: DEMO_SCHOOL, team: DEMO_TEAM },
  medical:         { role: "medical",              school: DEMO_SCHOOL },
  groundskeeper:   { role: "facilities",           school: DEMO_SCHOOL },
  driver:          { role: "driver",               school: DEMO_SCHOOL },
  player:          { role: "player",               school: DEMO_SCHOOL, person: "p1" },
  parent:          { role: "guardian",             school: DEMO_SCHOOL, children: [DEMO_CHILD] },
  spectator:       { role: "spectator",            school: DEMO_SCHOOL },
};

/** Assignments for a role name — legacy or current. */
export function assignmentsForRole(role) {
  const legacy = LEGACY_ROLE[role];
  if (legacy) return [legacy];
  if (ROLE_CAPABILITIES[role]) return [{ role, school: DEMO_SCHOOL }];
  return []; // unknown role ⇒ no authority. Default deny.
}

/** A principal the views can pass around. */
export function principalForRole(role) {
  return { role, assignments: assignmentsForRole(role) };
}

const assignmentsOf = (principal) =>
  Array.isArray(principal?.assignments)
    ? principal.assignments
    : assignmentsForRole(typeof principal === "string" ? principal : principal?.role);

// ── The legacy surface, on the new engine ───────────────

/**
 * `can(role, resource, action)` — kept for the views that already call it.
 *
 * Returns `{ allowed, scope, deny }`. `deny` is the list of fields the role
 * cannot see for this resource, which is what the UI uses to show a "some
 * fields hidden" affordance.
 *
 * Note this answers at ROLE level, without a specific row. It is therefore a
 * courtesy for UI gating only. The authoritative decision is per row, in
 * `getData()` below and in Postgres.
 */
export function can(role, resource, action = "r") {
  const def = RESOURCE[resource];
  const cap = def?.[ACTION[action] ?? "r"];
  if (!def || !cap) return { allowed: false, scope: "none", deny: [] };

  const assignments = assignmentsForRole(role);
  const { unrestricted, scopes } = scopeFilter({ assignments, capability: cap });
  const allowed = unrestricted || scopes.length > 0;

  const deny = Object.entries(maskMap(resource))
    .filter(([, needed]) => !assignments.some((a) => roleGrants(a.role, needed)))
    .map(([field]) => field);

  const scope = !allowed ? "none"
    : unrestricted ? "all"
    : scopes.every((s) => s.persons) ? "own"
    : scopes.every((s) => s.team) ? "team"
    : "school";

  return { allowed, scope, deny };
}

/** Live-scoring capability. Fails closed: no scoring.edit, no scoring. */
export function canScore(role) {
  return assignmentsForRole(role).some((a) => roleGrants(a.role, "scoring.edit"));
}

// ── Reading data ────────────────────────────────────────
const SOURCE = {
  players: () => PLAYERS,
  profiles: () => [...COACHES, ...STAFF],
  staff: () => STAFF,
  injuries: () => INJURIES,
  matches: () => MATCHES,
  competitions: () => COMPETITIONS,
};

/**
 * How a mock row's scope anchors resolve. The real tables carry these as
 * columns; the demo data uses different names, so the mapping lives here and
 * nowhere else.
 */
function anchorsOf(resource, row) {
  switch (resource) {
    case "players":
    case "profiles":
    case "staff":
      return { school: row.school ?? DEMO_SCHOOL, team: row.team ?? null, person: row.id ?? null };
    case "injuries": {
      // An injury row carries no school or team of its own — it links to a
      // player. Resolve the anchors through that player, exactly as the SQL
      // policy does (`SELECT p.team_code FROM player p WHERE p.id =
      // injury.player_id`). Without this the team anchor is null, and since a
      // null on the RESOURCE narrows, a team coach would see no injuries at
      // all rather than their own squad's.
      const pid = row.playerId ?? row.player ?? null;
      const p = pid ? PLAYERS.find((x) => x.id === pid) : null;
      return { school: p?.school ?? row.school ?? DEMO_SCHOOL, team: p?.team ?? null, person: pid };
    }
    case "matches":
      return { school: row.school ?? DEMO_SCHOOL, team: row.team ?? null, fixture: row.id ?? null };
    default:
      return { school: row.school ?? DEMO_SCHOOL, team: row.team ?? null };
  }
}

/** Null every field this principal may not see on this row. */
function maskRow(resource, row, assignments) {
  const mask = maskMap(resource);
  if (!Object.keys(mask).length) return row;
  const anchors = anchorsOf(resource, row);
  const out = { ...row };
  for (const [field, capability] of Object.entries(mask)) {
    if (!(field in out)) continue;
    // Masking is decided PER ROW, so a physio reads clinical notes for the
    // players their assignment covers and nothing outside it.
    if (!authorize({ assignments, capability, resource: anchors }).allowed) out[field] = null;
  }
  return out;
}

/**
 * The choke point. Row-scoped and column-masked, in that order.
 *
 * In production the body becomes an authenticated call to read-api and the
 * signature does not change.
 */
export function getData(resource, principal) {
  const def = RESOURCE[resource];
  if (!def) return [];
  const assignments = assignmentsOf(principal);
  const rows = (SOURCE[resource] ?? (() => []))();
  return rows
    .filter((row) => authorize({ assignments, capability: def.r, resource: anchorsOf(resource, row) }).allowed)
    .map((row) => maskRow(resource, row, assignments));
}

/** Single-record variant. Returns null when the row may not be read at all. */
export function filterRecord(role, resource, record) {
  if (!record) return record;
  const def = RESOURCE[resource];
  if (!def) return null;
  const assignments = assignmentsForRole(role);
  if (!authorize({ assignments, capability: def.r, resource: anchorsOf(resource, record) }).allowed) return null;
  return maskRow(resource, record, assignments);
}

/**
 * Count safely. Answers "how many, within what I may read" in one call, so a
 * dashboard card can never be built from a total computed over a wider scope
 * than the viewer's — the leak that shows a team coach a school-wide figure
 * without ever rendering a row.
 */
export function countData(resource, principal) {
  return getData(resource, principal).length;
}

/** Why a row is visible — for the "why am I seeing this?" affordance. */
export function grantedBy(resource, row, principal) {
  const def = RESOURCE[resource];
  if (!def) return null;
  const { via } = authorize({
    assignments: assignmentsOf(principal),
    capability: def.r,
    resource: anchorsOf(resource, row),
  });
  return via ? { role: via.role, school: via.school, team: via.team ?? null } : null;
}

export { RESOURCE as RBAC_RESOURCES };

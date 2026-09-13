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

import { authorize, scopeFilter, ANY_SCOPE } from "@scrbrd/policy/authorize";
import { roleGrants, ROLE_CAPABILITIES } from "@scrbrd/policy/roles";
import { TABLES, maskedColumns } from "@scrbrd/policy/tables";
import { teamCodeIn } from "@scrbrd/policy/teams";
// The demonstration vocabulary lives in its own leaf module: design/roles.js
// needs the same mapping, and declaring it in either of us makes the other
// import it — a cycle that shows up as a TDZ error rather than anything
// legible. See rbac/legacy-roles.js.
import { LEGACY_ROLE, DEMO_SCHOOL, DEMO_TEAM, DEMO_CHILD } from "./legacy-roles.js";
// Whether a session exists. NOT an authorization answer — it is the switch
// between "this is a demo on mock data" and "a server is deciding".
import { signedIn } from "../lib/api.js";
import {
  COACHES, COMPETITIONS, GROUNDS, INJURIES, MATCHES, NOTIFICATIONS,
  PLAYERS, SKILLS_MATRIX, STAFF, TRAINING_SESSIONS, USERS_INITIAL, WEATHER,
} from "../data/mock.js";

// ── Legacy resource names → capabilities ────────────────
// The views speak in resources ("injuries", "players"); the model speaks in
// capabilities. This table is the only place the two meet, and it is small on
// purpose — a new screen names an existing capability rather than inventing a
// resource.
const RESOURCE = {
  players:      { table: "player",      r: "player.profile.read",  c: "player.profile.manage", u: "player.profile.manage", d: "player.profile.manage" },
  coaches:      { table: "coach",       r: "user.read",            c: "user.invite",           u: "user.role.assign",      d: "user.role.assign" },
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
  // Everything below was previously read straight from the mock constants by
  // the views, with no scoping and no masking at all (handover §8.1 item 3).
  grounds:      { table: null,          r: "facility.read",        c: "facility.manage",       u: "facility.manage",       d: "facility.manage" },
  training:     { table: null,          r: "team.read",            c: "team.manage",           u: "team.manage",           d: "team.manage" },
  skills:       { table: null,          r: "player.development.read", c: "player.development.write", u: "player.development.write", d: "player.development.write" },
  notifications:{ table: null,          r: "news.read",            c: null,                    u: null,                    d: null },
  users:        { table: null,          r: "user.read",            c: "user.invite",           u: "user.role.assign",      d: "user.role.assign" },
  weather:      { table: null,          r: "fixture.read",         c: null,                    u: null,                    d: null },
};

const ACTION = { r: "r", read: "r", c: "c", create: "c", u: "u", update: "u", d: "d", delete: "d" };

/** field → the capability required to see it, for a legacy resource. */
function maskMap(resource) {
  const def = RESOURCE[resource];
  const table = def?.table ? TABLES[def.table] : null;
  const out = {};
  // maskedColumns() rather than table.masked, because there are two mask
  // groups now and reading only one of them is exactly how the browser stopped
  // masking `born` while Postgres carried on doing it.
  for (const [cap, cols] of Object.entries(table ? maskedColumns(table) : {}))
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
  coaches: () => COACHES,
  staff: () => STAFF,
  injuries: () => INJURIES,
  matches: () => MATCHES,
  competitions: () => COMPETITIONS,
  grounds: () => GROUNDS,
  training: () => TRAINING_SESSIONS,
  notifications: () => NOTIFICATIONS,
  users: () => USERS_INITIAL,
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
    case "coaches":
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
    case "matches": {
      // A fixture belongs to the team playing it. The demo rows name the side
      // in `homeTeam` ("Hilton 1st XI") rather than carrying a team code, so the
      // anchor is parsed from it; the real `match` table has team_code.
      // Without this the team anchor is null, and a null on the RESOURCE
      // narrows — which left a coach, and a SCORER, seeing no fixtures at all.
      const token = teamCodeIn(String(row.homeTeam ?? row.team ?? ""));
      // A fixture is not ABOUT a person, so a guardian's child-scoped
      // assignment still reaches it — as it must, or a parent cannot see when
      // their child plays. Spectators already see the full fixture list, so
      // this discloses nothing new.
      return { school: row.school ?? DEMO_SCHOOL, team: token, fixture: row.id ?? null, person: ANY_SCOPE };
    }
    // School-level resources: a ground, a competition, a notice belongs to the
    // institution, not to a team, so a team-scoped assignment still reaches
    // them. Declared, never inferred — see ANY_SCOPE.
    case "grounds":
    case "competitions":
    case "notifications":
    case "weather":
    case "fields":
      return { school: row.school ?? DEMO_SCHOOL, team: ANY_SCOPE, fixture: ANY_SCOPE, person: ANY_SCOPE };
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
 * The choke point — and, in a live session, a closed door.
 *
 * This function filters MOCK rows through a client-side copy of authorize().
 * That was the right thing while there was no server: the alternative was
 * nineteen views each filtering the whole dataset in their own component. It
 * is the wrong thing the moment a session exists, because a decision made here
 * is a decision made in the browser, and the browser does not get to decide.
 *
 * So it refuses. When someone is signed in, this returns nothing at all and
 * the rows come from lib/live.js, which asks the API, which asks Postgres,
 * which applies the same policy this file is a copy of. The copy remains for
 * exactly one purpose: the demo that has to open on a laptop with no backend.
 *
 * Returning [] rather than throwing is deliberate. A missed call site should
 * degrade to an empty list — visibly wrong, trivially found — and not take
 * down a screen a scorer is standing in a field holding. The console warning
 * is how it gets found; the empty list is how nobody gets hurt while it is
 * being found.
 */
export function getData(resource, principal) {
  if (signedIn()) {
    if (typeof console !== "undefined" && !warned.has(resource)) {
      warned.add(resource);
      console.warn(
        `[scrbrd] getData("${resource}") was called in a live session and refused. ` +
        `Client-side scoping is demo-only — read through useLive("${resource}", role) ` +
        `in lib/live.js so the server decides.`);
    }
    return [];
  }
  const def = RESOURCE[resource];
  if (!def) return [];
  const assignments = assignmentsOf(principal);
  const rows = (SOURCE[resource] ?? (() => []))();
  return rows
    .filter((row) => authorize({ assignments, capability: def.r, resource: anchorsOf(resource, row) }).allowed)
    .map((row) => maskRow(resource, row, assignments));
}

/** One warning per resource, not one per render. */
const warned = new Set();

/** Single-record variant. Returns null when the row may not be read at all. */
export function filterRecord(role, resource, record) {
  if (!record) return record;
  // A row the SERVER sent has already been authorised and masked, per column,
  // by the policy that knows this person's real assignments. Re-deciding it
  // here against the demo's role-to-assignment table is the browser deciding,
  // and deciding wrongly: the demo anchors on "HIL" and the server on an id,
  // so a live player's profile was refused for everyone and never opened.
  if (record.live) return record;
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

// ── The accessor views use ──────────────────────────────
/**
 * `scoped(resource, role)` — the read a view performs instead of importing a
 * mock constant.
 *
 * Views previously did `import { PLAYERS } from "../data/mock.js"` and
 * filtered in the component, which meant every list, every count and every
 * search result was computed over the whole dataset regardless of who was
 * looking. Eighteen modules did this. Binding the same name from here instead
 * keeps each view's body unchanged while putting the decision back in front of
 * the data.
 *
 * `data/mock.js` is imported by this module and by nothing else; a test in
 * rbac.test.mjs fails the build if that changes.
 */
export function scoped(resource, role) {
  return getData(resource, principalForRole(role));
}

/**
 * Skills are keyed by player id rather than being a list, so scoping means
 * keeping only the entries for players this principal may read.
 */
export function scopedSkills(role) {
  // Reads SKILLS_MATRIX directly rather than through getData(), so the guard
  // above does not cover it — it needs its own. Live sessions read the
  // `skills` resource, which is governed by player.development.read in
  // Postgres and reaches a coach's own squad only.
  if (signedIn()) return {};
  const visible = new Set(scoped("players", role).map((p) => p.id));
  return Object.fromEntries(Object.entries(SKILLS_MATRIX).filter(([id]) => visible.has(id)));
}

/**
 * The dashboard's figures, for the DEMO ONLY.
 *
 * In a live session this function is never the source of a number: lib/live.js
 * calls /api/read/summary and every figure is a scalar subquery against the
 * same masked view the detail query reads, so a count receives the identical
 * authorisation scope as the records it counts. That is the whole point, and
 * counting here instead would put the decision back in the browser.
 *
 * It returns null when signed in rather than an empty object, so a caller that
 * wires this up by mistake renders nothing visible rather than a plausible
 * zero. A wrong number that looks right is the failure this file exists to
 * avoid; an obviously missing card gets found in a minute.
 *
 * Counting through scoped() rather than the mock constants keeps the demo
 * honest too — a demo dashboard showing school-wide totals to a team coach
 * would misrepresent the product to the person being shown it.
 */
export function demoSummary(role) {
  if (signedIn()) return null;
  const players = scoped("players", role);
  const injuries = scoped("injuries", role);
  const notifications = scoped("notifications", role);
  const training = scoped("training", role);
  const matches = scoped("matches", role);
  const upcoming = matches.filter((m) => m.status === "upcoming");
  return {
    activePlayers:    players.length,
    injuriesActive:   injuries.filter((i) => i.restricted).length,
    unreadAlerts:     notifications.filter((n) => !n.read).length,
    sessionsThisWeek: training.length,
    upcomingMatches:  upcoming.length,
    // The demo carries no results ladder, and inventing a win rate to fill the
    // card would be exactly the fabrication the live query refuses to make.
    winRatePct:       null,
    nextMatchAt:      upcoming[0]?.date ?? null,
    scopeMatches:     matches.length,
    scopePlayers:     players.length,
    // The demo has no ball log to derive a career from, and a plausible
    // average is worse than an obviously absent one.
    myRuns:           null,
    myBattingAverage: null,
    myStrikeRate:     null,
  };
}

/** Weather is keyed by match id, and carries no personal data. */
export function scopedWeather(role) {
  // Same reasoning as scopedSkills: WEATHER is read straight from the mock, so
  // the choke point never sees it.
  if (signedIn()) return {};
  const visible = new Set(scoped("matches", role).map((m) => m.id));
  return Object.fromEntries(Object.entries(WEATHER).filter(([id]) => visible.has(id)));
}

export { RESOURCE as RBAC_RESOURCES };

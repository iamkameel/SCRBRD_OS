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
import { roleGrants, ROLE_CAPABILITIES, SUBJECT_SCOPED_ROLES, TEAM_SCOPED_ROLES } from "@scrbrd/policy/roles";
import { TABLES, maskedColumns } from "@scrbrd/policy/tables";
import { teamCodeIn } from "@scrbrd/policy/teams";
// The demonstration's own anchors — not database ids, see demo-scope.js.
import { DEMO_SCHOOL, DEMO_TEAM, DEMO_CHILD } from "./demo-scope.js";
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
// The role switcher, LoginPage's accounts and OnboardingFlow's persona
// picker all speak the policy's own role names now (SCRBRD-027 retired the
// pre-migration vocabulary — superadmin-as-alias, headmaster, sportsmaster,
// parent, assistant… — that rbac/legacy-roles.js used to translate). This
// function no longer translates a legacy name; it builds a demo ASSIGNMENT
// for a real one, which is a different job: even a canonical role name needs
// a school (and sometimes a team, or a person) before authorize() can decide
// anything with it.

/**
 * Two roles are platform-wide by construction, not school-scoped: operating
 * the platform is not being at a school. `school: null` is what makes an
 * assignment reach across every tenant (see authorize()'s own comment on
 * `covers()`) — the one thing the generic branch below cannot produce, since
 * it exists to scope INTO the demo school, not out of it.
 *
 * superadmin is the owner's key and holds every capability; without this it
 * would still be scoped to HIL and never demonstrate what "platform-wide"
 * means. platformadmin holds no medical or PII-reading capability at all —
 * "operating the platform is not a licence to browse" — so this changes
 * nothing about what it can see, only where: school.read, user.read and
 * audit.read reach every institution, as they do for a real platform
 * account, rather than only the demo's own school.
 */
const PLATFORM_WIDE_ROLES = new Set(["superadmin", "platformadmin"]);

/**
 * Assignments for a policy role name.
 *
 * The demonstration scope has to obey the same two shape rules the database
 * enforces, or it demonstrates something the product does not do.
 *
 *   TEAM_SCOPED_ROLES must name a team. A null team_code widens to every team
 *   in the school, and the policy is blunt about what that means for a coach:
 *   "a coach assignment with no team is a coach who reads every child at the
 *   school". Postgres refuses it with a CHECK constraint.
 *
 *   SUBJECT_SCOPED_ROLES must name a person. "A guardian row with no subject
 *   rows is a parent who reads every child at the school." app_can() refuses
 *   those outright, so a live session cannot produce one.
 *
 * A bare `{ role, school }` skips both, so the demonstration's own guardian
 * saw all eighteen pupils instead of one child — measurably, not
 * theoretically — and its assistant coach saw the whole school rather than a
 * side. Nothing was insecure: the client scoping is a demo fixture and a
 * live session is decided in Postgres. But it put the exact failure the
 * policy exists to prevent on screen, in the product whose central claim is
 * that it does not do that.
 *
 * Two roles need a narrower anchor than TEAM_SCOPED_ROLES/SUBJECT_SCOPED_ROLES
 * give them, because the database's own shape rules do not happen to cover
 * them:
 *
 *   `player` is not in SUBJECT_SCOPED_ROLES (that list is what app_can()
 *   itself refuses an unscoped row for; a player's own visibility is scoped
 *   by a different mechanism in Postgres). Left to the generic branch it
 *   gets no `person` at all — and covers() treats an absent `person` as no
 *   restriction, so the demo's own pupil would read every player at the
 *   school. Named to "p1" (James Whitfield, the demo's own signed-in pupil),
 *   not DEMO_CHILD ("p5"), because the two personas are different people —
 *   the smoke walk signs in as James and asserts on his row specifically.
 *
 *   `scorer` is not in TEAM_SCOPED_ROLES either, so left to the generic
 *   branch it would read fixtures for every team in the school rather than
 *   the one side a scorer is actually assigned to. Narrowed to DEMO_TEAM for
 *   the same reason a coach is: it is what the role is FOR.
 */
const DEMO_SCOPE_OVERRIDE = {
  player: { person: "p1" },
  scorer: { team: DEMO_TEAM },
};

export function assignmentsForRole(role) {
  if (!ROLE_CAPABILITIES[role]) return []; // unknown role ⇒ no authority. Default deny.

  const a = { role, school: PLATFORM_WIDE_ROLES.has(role) ? null : DEMO_SCHOOL };
  if (TEAM_SCOPED_ROLES.includes(role)) a.team = DEMO_TEAM;
  // A guardian is named against the children they are responsible for; a pupil
  // reading their own file, and a front desk looking one up, are named against
  // the person themselves.
  if (SUBJECT_SCOPED_ROLES.includes(role)) {
    if (role === "guardian") a.children = [DEMO_CHILD];
    else a.person = DEMO_CHILD;
  }
  Object.assign(a, DEMO_SCOPE_OVERRIDE[role]);
  return [a];
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

/**
 * Does this role hold a capability anywhere?
 *
 * The general form of canScore above, and the same courtesy: it decides what
 * to DRAW, never what to allow. Every figure it gates is already scoped in
 * Postgres, so a wrong answer here shows or hides a card — it cannot leak one.
 *
 * Takes a role name rather than a profile because the demonstration has no
 * profile, and a dashboard that only assembled itself for signed-in people
 * would be a dashboard nobody could be shown.
 */
export function holdsCapability(role, capability) {
  return assignmentsForRole(role).some((a) => roleGrants(a.role, capability));
}

/**
 * Are this role's figures about one person rather than a squad?
 *
 * A batting average on a dashboard means "yours" to a pupil and "whose?" to a
 * director of sport. The policy already draws this line — an assignment for
 * these roles must name a person — so the card follows it rather than keeping
 * a second list of who counts as personal.
 */
const PERSONAL_ROLES = new Set([...SUBJECT_SCOPED_ROLES, "player"]);
export function readsOwnRecord(role) {
  return assignmentsForRole(role).some((a) => PERSONAL_ROLES.has(a.role));
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

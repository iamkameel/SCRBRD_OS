/**
 * SCRBRD — the authorization decision.
 *
 * One rule, and it is worth stating before any code:
 *
 *   A person is allowed to do something if SOME SINGLE assignment they hold
 *   both grants the capability and covers the resource. Never a union across
 *   assignments.
 *
 * The distinction is the whole model. A person who coaches U16A and parents a
 * child in U14B holds `player.performance.read` through the coaching
 * assignment and `player.profile.read` through the guardian one. Unioning
 * those into a permission set would let the coaching capability apply to the
 * child's team — a capability from one context leaking into another. So the
 * capability and the scope are always evaluated together, on the same
 * assignment, or not at all.
 *
 * Default deny. An empty assignment list decides nothing.
 */

import { ROLE_CAPABILITIES, roleGrants } from "./roles.mjs";

/**
 * @typedef {object} Assignment
 * @property {string}  role        one of ROLE_CAPABILITIES
 * @property {string?} school      institution id; null = platform-wide
 * @property {string?} team        team code; null = every team in `school`
 * @property {string?} season      season id; null = every season
 * @property {string[]?} children  guardian relationships (player ids)
 * @property {string?} person      the person this assignment is *about* (a
 *                                 player's own assignment over themselves)
 * @property {string?} fixture     narrows to a single fixture (scorers, officials)
 * @property {boolean?} active
 * @property {string?} from        ISO date, inclusive
 * @property {string?} until       ISO date, exclusive
 *
 * @typedef {object} Resource
 * @property {string?} school
 * @property {string?} team
 * @property {string?} season
 * @property {string?} person      the player/person the row is about
 * @property {string?} fixture
 */

const DENY = Object.freeze({ allowed: false, via: null, reason: "no_matching_assignment" });

/**
 * "This resource has no such dimension."
 *
 * There are three distinct things a resource can say about its team, and
 * collapsing any two of them is a bug:
 *
 *   "U16A"     — it belongs to that team.
 *   null       — the dimension is ABSENT and that should narrow. A staff
 *                record has no team, and a team-scoped coach must not get a
 *                staff directory. This is also what a query that simply forgot
 *                its anchor looks like, so it fails closed.
 *   ANY_SCOPE  — the dimension does not APPLY. A ground belongs to the school,
 *                not to a team, so a team-scoped coach reading it is correct:
 *                their team constraint restricts whose data they see, and a
 *                ground is nobody's.
 *
 * ANY_SCOPE must be set deliberately by the resource descriptor. It is never
 * inferred, so forgetting an anchor can never silently widen access.
 * Applies to `team`, `fixture` and `person` — a ground is not about a person
 * either, so a player or a guardian must be able to read one. The tenant
 * boundary (`school`) has no such escape.
 */
export const ANY_SCOPE = "*";

/** Is the assignment in force at `at`? */
export function isActive(a, at = new Date()) {
  if (a.active === false) return false;
  const t = at instanceof Date ? at : new Date(at);
  if (a.from && t < new Date(a.from)) return false;
  if (a.until && t >= new Date(a.until)) return false;
  return true;
}

/**
 * Does one assignment's scope cover this resource?
 *
 * A null on the assignment is a wildcard at that level: a school-wide
 * sportsmaster has `team: null` and covers every team in their school. A null
 * on the RESOURCE is not a wildcard — a resource that does not say which
 * school it belongs to cannot be covered by a school-scoped assignment, which
 * is what keeps an unscoped query from quietly matching everything.
 */
export function covers(a, resource = {}) {
  // Platform assignments (school: null) reach across tenants by design.
  if (a.school != null) {
    if (resource.school == null || resource.school !== a.school) return false;
  }
  if (a.team != null && resource.team !== ANY_SCOPE) {
    if (resource.team == null || resource.team !== a.team) return false;
  }
  if (a.season != null && resource.season != null && resource.season !== a.season) return false;
  if (a.fixture != null && resource.fixture !== ANY_SCOPE) {
    if (resource.fixture == null || resource.fixture !== a.fixture) return false;
  }
  // A guardian assignment reaches only its own children. This is checked
  // against the resource's subject, so a guardian never sees a team-wide row
  // simply because their child is in that team.
  if (a.children?.length && resource.person !== ANY_SCOPE) {
    if (resource.person == null || !a.children.includes(resource.person)) return false;
  }
  // A personal assignment (a player over themselves) reaches only themselves.
  if (a.person != null && resource.person !== ANY_SCOPE) {
    if (resource.person == null || resource.person !== a.person) return false;
  }
  return true;
}

/**
 * The decision.
 *
 * @returns {{allowed: boolean, via: Assignment|null, reason: string|null}}
 * `via` names the assignment that granted it — needed so the UI can say
 * "you see this because you coach U16A", and so an aggregate can be scoped by
 * the same assignment that authorised it.
 */
export function authorize({ assignments = [], capability, resource = {}, at = new Date() }) {
  if (!capability) return { ...DENY, reason: "no_capability_requested" };
  for (const a of assignments) {
    if (!isActive(a, at)) continue;
    if (!roleGrants(a.role, capability)) continue;
    if (!covers(a, resource)) continue;
    return { allowed: true, via: a, reason: null };
  }
  return DENY;
}

/** Convenience: the boolean, when the granting assignment does not matter. */
export const may = (args) => authorize(args).allowed;

/**
 * Every assignment that grants `capability`, whatever it covers.
 *
 * This is the answer to "what am I allowed to count over" — the question that
 * makes aggregates safe. A dashboard card showing "3 injured players" must be
 * built from these scopes rather than filtered after the fact: a count
 * computed over the whole school and then displayed to a team-scoped coach has
 * already leaked, even though no row was ever rendered.
 *
 * Use `scopeFilter()` below to turn the result into a query predicate.
 */
export function grantingAssignments({ assignments = [], capability, at = new Date() }) {
  return assignments.filter((a) => isActive(a, at) && roleGrants(a.role, capability));
}

/**
 * The scope set a query for `capability` may read over.
 *
 * Returns `{ unrestricted, scopes }`. `unrestricted` means a platform-wide
 * assignment grants it and no predicate is needed. Otherwise `scopes` is a
 * disjunction: a row is readable if it matches ANY entry.
 *
 * Callers must apply this to counts, charts, search, autocomplete, badges,
 * exports and activity feeds — not only to row reads. Anything that reaches
 * the database without one of these has bypassed authorization regardless of
 * whether a row was displayed.
 */
export function scopeFilter({ assignments = [], capability, at = new Date() }) {
  const granting = grantingAssignments({ assignments, capability, at });
  if (!granting.length) return { unrestricted: false, scopes: [] };
  if (granting.some((a) => a.school == null)) return { unrestricted: true, scopes: [] };
  const scopes = granting.map((a) => ({
    school: a.school,
    team: a.team ?? null,
    season: a.season ?? null,
    fixture: a.fixture ?? null,
    persons: a.children?.length ? [...a.children] : a.person ? [a.person] : null,
  }));
  return { unrestricted: false, scopes: dedupe(scopes) };
}

const dedupe = (rows) => {
  const seen = new Set();
  return rows.filter((r) => {
    const k = JSON.stringify(r);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

/**
 * The contexts a person is currently operating in, for the context switcher.
 *
 * Selecting one of these does not GRANT anything — it activates capabilities
 * the person already holds through that assignment. The server must re-derive
 * the decision from the assignment on every request; a selected context
 * arriving from the client is a hint about intent, never an authority.
 */
export function contexts({ assignments = [], at = new Date() }) {
  return assignments.filter((a) => isActive(a, at)).map((a) => ({
    role: a.role,
    school: a.school,
    team: a.team ?? null,
    season: a.season ?? null,
    label: [a.role, a.team, a.school].filter(Boolean).join(" · "),
    capabilities: ROLE_CAPABILITIES[a.role] ?? [],
  }));
}

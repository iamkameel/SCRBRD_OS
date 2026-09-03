/**
 * SCRBRD — the demonstration vocabulary.
 *
 * The demo accounts, the seeded fixtures and the old UI all speak role names
 * the authorization model has never heard of: `superadmin`, `headmaster`,
 * `sportsmaster`, `headcoach`. Each maps onto a real policy role, and each
 * needs a scope to be worth anything — a coach is a coach OF something.
 *
 * This lives in its own module because two things need it and neither should
 * own it. rbac/ turns a legacy name into assignments; design/ turns one into a
 * colour and a navigation. Declaring it in either would make the other import
 * it, and the import cycle that produces is a TDZ error at start-up rather
 * than anything legible.
 *
 * Nothing here grants authority. These are DEMONSTRATION identities: the
 * assignments they produce are evaluated by exactly the same authorize() call
 * as a real one, and against a live server they are replaced entirely by the
 * assignments the database holds.
 */

// These are the MOCK data's own keys, not database ids. The demo runs on
// data/mock.js, where a school is "HIL" and a player is "p5"; a live session
// gets its assignments from the server and never reaches this file.
export const DEMO_SCHOOL = "HIL";
export const DEMO_TEAM = "U19A";
export const DEMO_CHILD = "p5";

/** Legacy role name → the policy role it means, with its demonstration scope. */
export const LEGACY_ROLE = Object.freeze({
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
});

/** The same mapping without the scope, for anything that only needs the name. */
export const LEGACY_ROLE_NAMES = Object.freeze(
  Object.fromEntries(Object.entries(LEGACY_ROLE).map(([legacy, a]) => [legacy, a.role])),
);

/**
 * SCRBRD — the demonstration's own anchors.
 *
 * These are the MOCK data's keys, not database ids. The demo runs on
 * data/mock.js, where a school is "HIL", a team is "1XI" and a player is
 * "p5"; a live session gets its assignments from the server and never
 * reaches this file.
 *
 * Split out on its own (SCRBRD-027, when rbac/legacy-roles.js — the old
 * demonstration VOCABULARY these anchors used to live beside — was retired)
 * because design/roles.js used to need the same constants: it built its own
 * legacy-alias table from rbac/'s. That table is gone now that every
 * sign-in and onboarding entry point speaks the policy's own role names, but
 * these anchors are still exactly what assignmentsForRole() in rbac/index.js
 * needs to build a demo assignment, so they keep their own leaf module
 * rather than moving back into a file that no longer has a reason to import
 * them.
 */
export const DEMO_SCHOOL = "HIL";
export const DEMO_TEAM = "1XI";
export const DEMO_CHILD = "p5";

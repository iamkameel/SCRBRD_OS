/**
 * People, with every role each one holds.
 *
 * The `users` read gives one row per account and one role per row — the role
 * the account was opened with (app_user.role). The `assignments` read gives
 * every appointment, withdrawn ones included on purpose: it is the audit
 * surface. A person who is a coach and a parent is one account and two
 * appointments, and a list that shows one role per person is telling the
 * office something false about who can do what.
 *
 * This joins the two. It decides nothing about authority: both reads are
 * already row-scoped in Postgres for the reader, and what is joined here is
 * only what they were each allowed to send. A role is "ended" here only when
 * the row says it is; the server's own rule (authorize.mjs isActive) is the
 * one this mirrors for what it can see — `active`, `suspended`, and the
 * `valid_from`/`valid_until` dates.
 *
 * Pure, and the date is an argument: nothing in here reads the clock, so a
 * test names the day it means.
 */
import { GRANTABLE_ROLES, ROLE_CAPABILITIES, roleGrants } from "@scrbrd/policy/roles";
import { PLATFORM_ONLY } from "@scrbrd/policy/capabilities";

/** "live" | "paused" | "upcoming" | "ended" for one appointment on `today` (YYYY-MM-DD). */
export function roleState(a, today) {
  if (a.active === false) return "ended";
  if (a.validUntil && a.validUntil <= today) return "ended";
  if (a.suspended === true) return "paused";
  if (a.validFrom && a.validFrom > today) return "upcoming";
  return "live";
}

/** The day an ended appointment ended, where the row says: the date it was dated out, else the day it was withdrawn. */
export function endDayOf(a) {
  if (a.validUntil) return a.validUntil;
  return a.revokedAt ? String(a.revokedAt).slice(0, 10) : null;
}

/**
 * One entry per account: `{ ...user, roles: [{ key, role, team, state, endedOn, from }] }`.
 *
 * `users` are the `users` read's rows, `assignments` the `assignments` read's.
 * An account the assignments read says nothing about (a reader who may see the
 * account but not its appointments, or a demonstration with none) keeps the
 * one role the account itself carries, as a live role — the only thing known —
 * rather than appearing to hold nothing.
 *
 * Live roles come first, then paused and upcoming, then ended; within each, in
 * the order the read gave them (newest first).
 */
export function peopleWithRoles(users, assignments, today) {
  const by = new Map();
  for (const a of assignments ?? []) {
    if (!by.has(a.personId)) by.set(a.personId, []);
    by.get(a.personId).push(a);
  }
  const rank = { live: 0, paused: 1, upcoming: 2, ended: 3 };
  return (users ?? []).map((u) => {
    const held = by.get(u.id);
    const roles = held?.length
      ? held.map((a) => ({ key: a.id, role: a.role, team: a.team ?? null, school: a.school ?? null, state: roleState(a, today),
                           endedOn: endDayOf(a), from: a.validFrom ?? null, until: a.validUntil ?? null }))
      : [{ key: `${u.id}:${u.role}`, role: u.role, team: null, school: u.school ?? null, state: "live", endedOn: null, from: null, until: null }];
    // Array.prototype.sort is stable: the read's own order survives inside a rank.
    roles.sort((x, y) => rank[x.state] - rank[y.state]);
    return { ...u, roles };
  });
}

/** The roles somebody holds NOW — what a person is, as opposed to what they once were. */
export const liveRoles = (p) => p.roles.filter((r) => r.state === "live" || r.state === "paused");

/**
 * Does this person pass the three filters? The role filter looks across ALL
 * of their roles — live, paused and ended — because "who is, or was, a coach"
 * is the question a role filter is asked.
 *
 * `label` turns a role code into the words on screen, so searching "director"
 * finds the director of sport; `linked` is the roster name an account is for.
 */
export function matchesPerson(p, { role = "all", status = "all", q = "" }, { label = (r) => r, linked = () => null } = {}) {
  if (role !== "all" && !p.roles.some((r) => r.role === role)) return false;
  if (status !== "all" && p.status !== status) return false;
  const needle = String(q).trim().toLowerCase();
  if (!needle) return true;
  const hay = [p.name, p.email, linked(p),
    ...p.roles.flatMap((r) => [r.role, label(r.role), r.team])].filter(Boolean).join(" ").toLowerCase();
  return hay.includes(needle);
}

/** A role carrying a platform capability: granted only from an assignment that names no school (db/01's floor). */
const carriesPlatform = (role) => (ROLE_CAPABILITIES[role] ?? []).some((c) => PLATFORM_ONLY.includes(c));

/**
 * Disable or enable this account: which of the two to OFFER this reader, or
 * null for neither (account lifecycle D2, slice 1).
 *
 * WHAT TO OFFER, NEVER WHETHER. account_set_active() (db/85) asks db/81's
 * auth_office_refusal() on every post, and that answer is the only one that
 * counts. This mirrors it over what the reader can see, so the button is not
 * drawn where the server would say no:
 *   - never your own account (cannot_disable_yourself);
 *   - user.invite at the account's school, or on an assignment that names no
 *     school; an account with no school, only from the latter;
 *   - an account holding a standing role that names no school (the owner's
 *     key, a platform administrator): a superadmin only;
 *   - every standing role the account holds is one the reader could grant at
 *     its school (GRANTABLE_ROLES, as app_may_grant_at(), db/77); a pupil's
 *     `selfaccess` counts as `player`; a role carrying a platform capability
 *     only from an assignment that names no school.
 * "Standing" is live or paused: a paused role still counts, as on the server.
 * A role at a school whose appointments this reader cannot read is not on the
 * list, so the button may be drawn and then refused; the screen shows the
 * refusal in the server's words.
 *
 * `person` is one entry of peopleWithRoles(); `me` the session profile
 * ({ user: { id }, assignments: [{ role, school }] }).
 * @returns {"disable" | "enable" | null}
 */
export function accountAction(person, me) {
  if (!person || !me?.user?.id || person.id === me.user.id) return null;
  const mine = me.assignments ?? [];
  const at = (a, school) => a.school == null || (school != null && a.school === school);
  if (!mine.some((a) => at(a, person.school ?? null) && roleGrants(a.role, "user.invite"))) return null;
  const standing = (person.roles ?? []).filter((r) => r.state === "live" || r.state === "paused");
  if (standing.some((r) => r.school == null) && !mine.some((a) => a.school == null && a.role === "superadmin")) return null;
  const mayGrantAt = (role, school) => mine.some((a) => at(a, school)
    && (GRANTABLE_ROLES[a.role] ?? []).includes(role)
    && (a.school == null || !carriesPlatform(role)));
  const all = standing.every((r) => mayGrantAt(r.role, r.school ?? null)
    || (r.role === "selfaccess" && mayGrantAt("player", r.school ?? null)));
  if (!all) return null;
  return person.status === "active" ? "disable" : "enable";
}

#!/usr/bin/env node
/**
 * Emits db/01_authz.sql and db/09_rls_policies.sql from the policy model.
 * Never hand-edit the SQL; change packages/policy/ and run `pnpm rls:generate`.
 *
 * BOTH FILES ARE FROZEN ONCE PRODUCTION HAS RUN THEM. The migration ledger
 * refuses an applied file whose hash changed, and CI refuses a tree where
 * regenerating would change either file — so after go-live this generator
 * must keep reproducing the shipped bytes. A capability change is therefore
 * three edits, not one: roles.mjs (the truth for a fresh install and the
 * client), a new db/NN with the DELETE/INSERT for a database that already
 * has db/01, and WITHDRAWN_SINCE_01, ADDED_SINCE_01 or ROLES_ADDED_SINCE_01 below so the emitted
 * db/01 does not move. DEPLOYING.md, "Changing the schema after go-live",
 * has the procedure.
 *
 * What this emits
 * ───────────────
 *   1. role_capability rows            — the role→capability bundles
 *   2. app_can(...)                    — THE authorization decision, in SQL
 *   3. per-table RLS policies          — read/write, built on app_can
 *   4. *_masked views                  — per-row column masking, on app_can
 *   5. db/23_authz_time_box.sql        — the decision functions as they ran
 *                                        from db/23: db/01's, plus the hour hand
 *                                        a support assignment needs (SCRBRD-012)
 *   6. db/35_authz_suspension.sql      — the decision functions as they run
 *                                        today: db/23's, plus the pause on a
 *                                        suspended duty (SCRBRD-034)
 *   7. db/39_match_anchor_helpers.sql  — seven fixture-anchored tables'
 *                                        policies as they run today: db/09's,
 *                                        with the school/team anchor read
 *                                        through match_school()/match_team()
 *                                        (REANCHORED_IN_39)
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

import { GRANTABLE_ROLES, ROLE_CAPABILITIES, ROLES, SCORING_ROLES, SUBJECT_SCOPED_ROLES, TEAM_SCOPED_ROLES, unknownCapabilities } from "@scrbrd/policy/roles";
import { TABLES, isCapabilityExpression } from "@scrbrd/policy/tables";
import { teamCodeCheck } from "@scrbrd/policy/teams";
import { ALL_CAPABILITIES, PLATFORM_ONLY } from "@scrbrd/policy/capabilities";
/** @import { TableDef, Anchors } from "@scrbrd/policy/tables" */

const q = (/** @type {unknown} */ s) => `'${String(s).replaceAll("'", "''")}'`;
const banner = (/** @type {string} */ t) => `\n-- ══════════════════════════════════════════════════════════════════\n--  ${t}\n-- ══════════════════════════════════════════════════════════════════`;

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
/**
 * @param {string} table
 * @param {TableDef} def
 * @param {keyof Anchors} key
 * @param {keyof typeof ANY} cast
 */
const anchor = (table, def, key, cast) => {
  if (!(key in (def.anchors ?? {}))) return ANY[cast];   // dimension does not apply
  const col = def.anchors[key];
  if (!col) return `NULL::${cast}`;                       // stated as absent → narrows
  return col.startsWith("(") ? col : `${table}.${col}`;
};

/**
 * A capability slot, as SQL.
 *
 * Usually a literal name. Sometimes the capability is a property OF THE ROW
 * rather than of the table — a notification declares the capability its
 * subject matter requires, and publishing one is gated by its own scope level
 * — and then the slot is a parenthesised SQL expression, the same convention
 * the anchors already use. Passing a column through here rather than
 * inventing a second decision function keeps every authorization answer coming
 * out of app_can().
 */
const capExpr = (/** @type {string} */ c) => (isCapabilityExpression(c) ? c : q(c));

/**
 * @param {string} table
 * @param {TableDef} def
 * @param {string} capability
 * @param {Anchors} [anchors]
 */
const callCan = (table, def, capability, anchors = def.anchors) => {
  const at = { ...def, anchors };
  const args = [
    capExpr(capability),
    anchor(table, at, "school", "uuid"),
    anchor(table, at, "team", "text"),
    anchor(table, at, "person", "uuid"),
    anchor(table, at, "fixture", "uuid"),
  ];
  return `app_can(${args.join(", ")})`;
};

/**
 * The hour hand on an assignment.
 *
 * valid_from/valid_until are DATES — an appointment runs for a season, and a
 * guardian's link ends on a birthday. SCRBRD-012's support access runs for an
 * hour, and a date cannot say so. db/22 adds role_assignment.expires_at
 * (timestamptz, NULL for every ordinary appointment), and the liveness rule
 * in every decision function gains one line.
 *
 * WHY A FLAG AND NOT AN EDIT. db/01_authz.sql has run on a database that must
 * never be reset, and the ledger refuses a file whose hash changed — so the
 * three functions cannot be changed where they were born. They are emitted
 * again, with the line, into a second generated file (db/23_authz_time_box.sql,
 * timeBox() below), and this generator keeps emitting db/01 exactly as it
 * shipped. A fresh install replays both and ends where production is. The
 * template stays the single source of the decision; the flag is the only
 * difference between what shipped and what runs.
 */
const liveness = (/** @type {boolean} */ timeBoxed, suspendable = false) => (timeBoxed
  ? "\n       AND (a.expires_at IS NULL OR a.expires_at > now())"
  : "") + (suspendable ? SUSPENSION : "");

/**
 * The pause on a duty (SCRBRD-034, db/34 and db/35).
 *
 * A duty the school office has suspended rests on an assignment that must
 * grant nothing until the suspension is lifted — and lifting must bring it
 * back. `active` cannot carry that: db/01's role_assignment_revoke_only()
 * refuses to reactivate a withdrawn row, and rightly, so false is forever.
 * The suspension is therefore its own row (duty_suspension, db/34), open
 * until somebody lifts it with a reason, and the liveness rule gains a
 * second line reading it.
 *
 * The same flag discipline as the hour hand: db/01 and db/23 keep emitting
 * exactly what shipped, and the functions are emitted once more, with both
 * lines, into db/35_authz_suspension.sql (suspension() below). db/34 must
 * run first because a SQL function's body is checked against the tables it
 * names when it is created.
 */
const SUSPENSION = "\n       AND NOT EXISTS (SELECT 1 FROM duty_suspension s"
  + "\n                        WHERE s.assignment_id = a.id AND s.lifted_at IS NULL)";
// db/16 pinned every SECURITY DEFINER function's search_path with ALTER
// FUNCTION — and CREATE OR REPLACE discards that, so a re-emitted function
// has to carry the pin in its own definition or it comes back unpinned. The
// verifier caught exactly that on the first run of db/23.
const definerTail = (/** @type {boolean} */ timeBoxed) => timeBoxed
  ? "$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp;"
  : "$$ LANGUAGE sql STABLE SECURITY DEFINER;";

function decisionFunction({ timeBoxed = false, suspendable = false } = {}) {
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
       AND (a.valid_until IS NULL OR a.valid_until >  current_date)${liveness(timeBoxed, suspendable)}
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
       -- WHO the assignment is about. An assignment naming people reaches ONLY
       -- those people: a guardian's children, and a pupil's own record. An
       -- assignment naming nobody is about nobody in particular and is scoped
       -- by school and team alone, which is how a coach reaches their squad —
       -- EXCEPT for the roles that only make sense about a person, which are
       -- refused outright rather than widened (SUBJECT_SCOPED_ROLES).
       --
       -- A LIVE link is verified, started and not ended. Verification is what
       -- turns a claimed relationship into a permission, and 'pending' is the
       -- column default, so nothing reaches a child until somebody at the
       -- school put their name to the link.
       AND CASE WHEN a.role = ANY (ARRAY[${SUBJECT_SCOPED_ROLES.map(q).join(", ")}]::text[]) THEN
             -- A role that only means anything ABOUT SOMEBODY. It must name a
             -- live person, and then reaches that person and rows with no
             -- person dimension (a fixture: which is how a parent sees when
             -- their child is playing). Name nobody live and it reaches
             -- nothing at all — not the school, not a fixture.
             EXISTS (SELECT 1 FROM assignment_subject g
                      WHERE g.assignment_id = a.id
                        AND g.verification_state = 'verified'
                        AND g.valid_from <= current_date
                        AND (g.valid_until IS NULL OR g.valid_until > current_date))
             AND (p_person = ${ANY.uuid}
                  OR (p_person IS NOT NULL AND EXISTS (
                        SELECT 1 FROM assignment_subject g
                         WHERE g.assignment_id = a.id AND g.player_id = p_person
                           AND g.verification_state = 'verified'
                           AND g.valid_from <= current_date
                           AND (g.valid_until IS NULL OR g.valid_until > current_date))))
           ELSE
             -- Everyone else. Naming nobody means "about nobody in
             -- particular", scoped by school and team, which is how a coach
             -- reaches their squad. The NOT EXISTS counts EVERY row, live or
             -- not: filtering it to live links would mean that revoking the
             -- last link turns a person-scoped assignment into a school-wide
             -- one, so revocation would WIDEN access.
             NOT EXISTS (SELECT 1 FROM assignment_subject g WHERE g.assignment_id = a.id)
             OR p_person = ${ANY.uuid}
             OR (p_person IS NOT NULL AND EXISTS (
                   SELECT 1 FROM assignment_subject g
                    WHERE g.assignment_id = a.id AND g.player_id = p_person
                      AND g.verification_state = 'verified'
                      AND g.valid_from <= current_date
                      AND (g.valid_until IS NULL OR g.valid_until > current_date)))
           END
  )
${definerTail(timeBoxed)}

REVOKE ALL ON FUNCTION app_can(text, uuid, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_can(text, uuid, text, uuid, uuid) TO PUBLIC;

-- app_holds(capability) — does this person hold the capability AT ALL?
--
-- app_can() asks whether someone may act on a particular ROW, and every
-- governed row belongs to a tenant. A few decisions have no row and no tenant:
-- verifying a scout's accreditation, or turning a product feature off across
-- the whole platform. There is no ANY_SCOPE for school, so handing app_can() a
-- placeholder anchor does not widen it — it refuses everyone, silently, which
-- is exactly what happened the first time the scouting register tried it.
--
-- This is that same existence check with the scope arms removed, and it has a
-- name because it had already been written out by hand three times. Each copy
-- repeated the valid_from IS NULL comparison that silently refused every
-- open-ended assignment until it was found, and every copy omitted a.active
-- — so a deactivated assignment still passed them. One of those is a bug that
-- was caught; the other was not, and that is the argument for one definition.
--
-- NOT a bypass. Holding a capability somewhere is not permission to touch a
-- particular school's rows: anything with a tenant still goes through
-- app_can(), and this answers only the tenant-less question.
CREATE OR REPLACE FUNCTION app_holds(p_capability text) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1
      FROM role_assignment a
      JOIN role_capability rc
        ON rc.role = a.role
       AND rc.capability = p_capability
      JOIN capability c
        ON c.name = rc.capability
     WHERE a.person_id = app_user_id()
       AND a.active
       AND (NOT c.platform_only OR a.school_id IS NULL)
       AND (a.valid_from  IS NULL OR a.valid_from  <= current_date)
       AND (a.valid_until IS NULL OR a.valid_until >  current_date)${liveness(timeBoxed, suspendable)}
  )
${definerTail(timeBoxed)}

REVOKE ALL ON FUNCTION app_holds(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_holds(text) TO PUBLIC;

-- There is deliberately NO can_score(role) here. It existed, it was correct,
-- and nothing called it after the scoring policies moved to app_can() — which
-- makes it worse than useless: a role-shaped decision function sitting in the
-- schema is an invitation to reach for it, and reaching for it reintroduces
-- the exact hole ADR 0001 closed (a role the session asserts, evaluated
-- without a scope). Scoring authority is app_can('scoring.edit', ...) against
-- the assignments the database looks up, and there is no second way to ask.`;
}

/**
 * Roles whose assignment must name a team, as a constraint.
 *
 * Generated rather than written into 00_schema_core.sql by hand, so the list
 * cannot drift from the policy model — a role added to TEAM_SCOPED_ROLES is
 * enforced on the next migration without anyone remembering to edit SQL.
 */
function teamScopedConstraint() {
  const list = TEAM_SCOPED_ROLES.map(q).join(", ");
  return `${banner("Assignments that must name a team")}
-- A NULL team_code widens to every team in the school. That is right for a
-- head of sport and wrong for a coach: a coach reaches a player's medical
-- information because they coach that player's CURRENT side, and an assignment
-- with no team is a coach who reads every child at the school.
--
-- Dropped and recreated so the generated list is authoritative on every run.
ALTER TABLE role_assignment DROP CONSTRAINT IF EXISTS assignment_team_scoped;
ALTER TABLE role_assignment ADD CONSTRAINT assignment_team_scoped CHECK (
  role NOT IN (${list}) OR team_code IS NOT NULL
);`;
}

/**
 * Every team_code column, kept inside the vocabulary.
 *
 * A team code is a SCOPE ANCHOR — app_can() compares it for equality on every
 * decision — so a typo does not fail loudly, it fails closed and silently: the
 * assignment simply covers nothing, and a coach finds an empty screen with no
 * error anywhere to explain it. A constraint turns that into a rejected write
 * at the moment the mistake is made.
 *
 * Generated from packages/policy/src/teams.mjs so the database and the module
 * cannot disagree about what a team is. The regex admits every age band ANY
 * level uses, because a single CHECK cannot know whether a row belongs to a
 * school or a province — U19 is legal here and refused for a school by
 * isValidTeam(), which knows the level.
 */
function teamCodeConstraints() {
  const cols = ["player", "coach", "match", "role_assignment",
                "training_session", "competition_entrant", "notification"];
  const out = [banner("Team codes are a closed vocabulary")];
  for (const t of cols) {
    out.push(`ALTER TABLE ${t} DROP CONSTRAINT IF EXISTS ${t}_team_code_known;
ALTER TABLE ${t} ADD CONSTRAINT ${t}_team_code_known CHECK (${teamCodeCheck("team_code")});`);
  }
  return out.join("\n");
}

/**
 * A grant db/01_authz.sql already shipped, withdrawn since by its own
 * db/NN file rather than by rewriting db/01.
 *
 * db/01_authz.sql runs once per database and is then history: the ledger in
 * tools/migrate.mjs refuses a file whose hash no longer matches what it
 * recorded, on a production database that must not be reset — the same rule
 * that keeps db/00-14 frozen after go-live. ROLE_CAPABILITIES is nonetheless
 * the single live model, read by authorize()/scopeFilter(), the client's
 * rbac choke point, and every test — narrowing it there is correct and
 * immediate. Reproducing db/01's ORIGINAL bootstrap grants is what stops
 * that correct edit from silently rewriting an already-shipped file the
 * moment somebody runs `pnpm rls:generate` again.
 *
 * Each entry is retired here once its own db/NN file exists and has landed:
 * a fresh install then grants it here and withdraws it there, exactly
 * replaying what happened to a database that was already live when the
 * decision changed. See db/21_coach_medical_overview.sql and ADR 0002.
 *
 * `after` reproduces db/01's ORIGINAL position for the row, not just its
 * presence — the two sit byte-for-byte where they always did, immediately
 * after `medical.nature.read`, so this stays a true reproduction of the
 * shipped file rather than the same rows in a new order.
 */
/** @type {Record<string, { after: string, capability: string }[]>} */
export const WITHDRAWN_SINCE_01 = {
  coach:           [{ after: "medical.nature.read", capability: "medical.details.read" }],
  assistantcoach:  [{ after: "medical.nature.read", capability: "medical.details.read" }],
  // SCRBRD-030 moved the commercial reads to the `sponsorship` role; db/27 withdraws them.
  finance: [
    { after: "user.read",          capability: "sponsorship.read" },
    { after: "sponsorship.read",   capability: "sponsorship.manage" },
    { after: "sponsorship.manage", capability: "sponsorship.finance.read" },
  ],
};

/**
 * Roles that did not exist when db/01 shipped. Left out of db/01's bundles,
 * its role_grantable rows and its header count; the db/NN named here creates
 * them, on a fresh install and on production alike. Never retires.
 */
export const ROLES_ADDED_SINCE_01 = {
  sponsorship: "27_sponsorship_role.sql",
};
const roleIn01 = (/** @type {string} */ role) => !(role in ROLES_ADDED_SINCE_01);

/**
 * The mirror: capabilities that did not exist when db/01 shipped.
 *
 * db/01 inserts the whole catalogue and every bundle, so a new name in
 * capabilities.mjs would otherwise land in the frozen file twice — once as a
 * catalogue row and once per role that holds it. Each name here is LEFT OUT
 * of db/01's emission entirely, and the db/NN it maps to is where a database
 * — fresh or live — actually receives it: the catalogue row first, then the
 * role_capability rows for every role the model grants it to, then whatever
 * policy the capability was introduced to gate. A fresh install therefore
 * reaches the same state as production by the same path, which is the
 * property WITHDRAWN_SINCE_01 exists to keep.
 *
 * rls.test.mjs holds each entry to that: the name appears nowhere in db/01,
 * and the file it names carries a catalogue row and a role row for every
 * holder in roles.mjs. An entry never retires — the day db/01 is regenerated
 * onto a fresh cluster it must still omit the name, or the ledger sees a
 * changed file.
 */
export const ADDED_SINCE_01 = {
  "scoring.amend.request": "24_amend_request.sql",
};
const shippedIn01 = (/** @type {string} */ cap) => !(cap in ADDED_SINCE_01);

function capabilityRows() {
  const rows = [];
  for (const role of ROLES.filter(roleIn01)) {
    const bundle = [...ROLE_CAPABILITIES[role]].filter(shippedIn01);
    for (const { after, capability } of WITHDRAWN_SINCE_01[role] ?? []) {
      const at = bundle.indexOf(after);
      bundle.splice(at === -1 ? bundle.length : at + 1, 0, capability);
    }
    for (const cap of bundle) rows.push(`  (${q(role)}, ${q(cap)})`);
  }
  const catalogue = ALL_CAPABILITIES.filter(shippedIn01).map((c) => `  (${q(c)})`).join(",\n");
  const grantRows = [];
  for (const [granter, granted] of Object.entries(GRANTABLE_ROLES))
    for (const r of granted) if (roleIn01(granter) && roleIn01(r)) grantRows.push(`  (${q(granter)}, ${q(r)})`);
  return `${banner("The capability catalogue")}
-- Every capability the model defines, as rows, so a column that stores a
-- capability NAME can have a foreign key onto it — notification.required_capability
-- is the one that does. Without this, a typo in a published notice becomes a
-- notification nobody can read, which fails closed but fails silently, and the
-- person who published it has no way to discover that nobody received it.
--
-- Inserted, never deleted: rows here are referenced. A capability retired from
-- the model leaves its row behind rather than breaking the references to it,
-- and grants no authority on its own — authority comes from role_capability.
CREATE TABLE IF NOT EXISTS capability (name text PRIMARY KEY);
-- Which capabilities belong to no tenant. See PLATFORM_ONLY in
-- packages/policy/src/capabilities.mjs for the escalation that put this here.
ALTER TABLE capability ADD COLUMN IF NOT EXISTS platform_only boolean NOT NULL DEFAULT false;
INSERT INTO capability (name) VALUES
${catalogue}
ON CONFLICT (name) DO NOTHING;
-- Set every regeneration, in both directions, so removing a name from
-- PLATFORM_ONLY actually relaxes the rule rather than leaving a stale true.
UPDATE capability SET platform_only = (name IN (${PLATFORM_ONLY.filter(shippedIn01).map(q).join(", ")}));

-- Readable by everyone, writable by nobody but a migration. The names are
-- already in the client bundle, so there is nothing to protect by hiding them
-- — but the catalogue must not be writable by the application, or a row could
-- be added to make a notification's declared capability satisfiable by a role
-- that was never granted it. RLS is enabled with an open read rather than left
-- off, so the "no public table has row-level security disabled" assertion in
-- db/99_rls_verify.sql stays a blanket rule with no exceptions list to drift.
ALTER TABLE capability ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS capability_read ON capability;
CREATE POLICY capability_read ON capability FOR SELECT USING (true);
-- The matching REVOKE of write access lives in db/06_app_role.sql, not here:
-- scrbrd_app is created there, and this file runs first. Revoking from a role
-- that does not exist yet is an error on a fresh cluster — and it would not
-- have been caught locally, because roles are cluster-level and survive the
-- DROP SCHEMA that migrate --reset does.

${banner("Role → capability bundles")}
-- Replaced wholesale on every regeneration.
DELETE FROM role_capability;
INSERT INTO role_capability (role, capability) VALUES
${rows.join(",\n")};

-- A FOREIGN KEY ONTO THE CATALOGUE, added here rather than in the schema
-- because capability is created here and this file runs first.
--
-- This is the single cheapest guard against the way the previous build was
-- lost. There, the permission check compared role LABELS while the data stored
-- role CODES, so every check was permanently false, every write was denied,
-- and the account that could have repaired it was gated behind the same check.
-- A misspelt capability here fails the same way: it grants nothing, silently,
-- and the symptom is a role that has stopped working for reasons nobody can
-- see. With the key in place the MIGRATION fails instead, loudly, before
-- anybody is locked out of anything.
DO $rc_fk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'role_capability_capability_fkey') THEN
    ALTER TABLE role_capability
      ADD CONSTRAINT role_capability_capability_fkey
      FOREIGN KEY (capability) REFERENCES capability(name);
  END IF;
END
$rc_fk$;

${banner("Who may appoint whom")}
-- Generated from GRANTABLE_ROLES in packages/policy/src/roles.mjs, which is
-- where the reasoning lives. user.role.assign says a person may make
-- appointments; this says which ones, and without it a school administrator
-- could appoint themselves to any role in the model.
CREATE TABLE IF NOT EXISTS role_grantable (
  granter text NOT NULL,
  role    text NOT NULL,
  PRIMARY KEY (granter, role)
);
ALTER TABLE role_grantable ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS role_grantable_read ON role_grantable;
CREATE POLICY role_grantable_read ON role_grantable FOR SELECT USING (true);
DELETE FROM role_grantable;
INSERT INTO role_grantable (granter, role) VALUES
${grantRows.join(",\n")};

${mayGrantFunction()}`;
}

function mayGrantFunction({ timeBoxed = false, suspendable = false } = {}) {
  return `-- app_may_grant(role) — may the caller appoint somebody to this role?
--
-- Two questions, both of which have to answer yes. Whether the caller's own
-- roles list this one as grantable, and — for a role carrying a tenant-less
-- capability — whether the caller's assignment is itself tenant-less. The
-- second is what stops a school-scoped grant of a platform role.
CREATE OR REPLACE FUNCTION app_may_grant(p_role text) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1
      FROM role_assignment a
      JOIN role_grantable g ON g.granter = a.role AND g.role = p_role
     WHERE a.person_id = app_user_id()
       AND a.active
       AND (a.valid_from  IS NULL OR a.valid_from  <= current_date)
       AND (a.valid_until IS NULL OR a.valid_until >  current_date)${liveness(timeBoxed, suspendable)}
       -- A role carrying a platform capability may only be handed out by
       -- somebody whose own assignment belongs to no school.
       AND (a.school_id IS NULL OR NOT EXISTS (
              SELECT 1 FROM role_capability rc
                JOIN capability c ON c.name = rc.capability AND c.platform_only
               WHERE rc.role = p_role))
  )
${definerTail(timeBoxed)}

REVOKE ALL ON FUNCTION app_may_grant(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_may_grant(text) TO PUBLIC;`;
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
/** @param {string} table @param {TableDef} def */
const readPredicate = (table, def) => {
  // `readAlso` is AND-ed, and it is the opposite kind of thing from
  // `visibleWhen`: an exception widens, a second requirement narrows. A
  // notification needs news.read AND the capability the row itself declares,
  // in the same scope, so the feed cannot become a way around every other
  // policy here. Both together parenthesise as (required AND also) OR
  // (exception) — get that precedence wrong and the exception silently
  // becomes a bypass of the extra requirement.
  const can = def.readAlso
    ? `${callCan(table, def, def.read)}\n       AND ${callCan(table, def, def.readAlso)}`
    : callCan(table, def, def.read);

  // `readAnchors` — THE SAME CAPABILITY, ASKED AT A SECOND SCOPE.
  //
  // A fixture between two SCRBRD schools is one row, and both schools must be
  // able to read it. The home side's anchors are on the row; the away side's
  // are different columns of the same row, and the question asked of them is
  // identical: does this person hold fixture.read over THAT school and team?
  //
  // Deliberately not `visibleWhen`, which takes raw SQL and can widen a policy
  // to anything its author writes. This can only ever ask app_can() again, at
  // anchors declared the same way the first set is — so a second side cannot
  // become a bypass, and the whole predicate is still nothing but a disjunction
  // of scoped capability checks. An away school with no fixture.read over its
  // own team sees nothing.
  //
  // OR-ed, and parenthesised around the AND above, because getting that
  // precedence wrong would let a second scope bypass a readAlso requirement.
  const sides = (def.readAnchors ?? []).map((a) => callCan(table, def, def.read, a));
  const scoped = sides.length ? `(${can})\n    OR ${sides.join("\n    OR ")}` : can;

  if (!def.visibleWhen) return scoped;
  return `(${scoped})\n    OR (${def.visibleWhen.trim()})`;
};

/**
 * Tables whose fixture anchors moved from a plain subquery to the SECURITY
 * DEFINER helpers match_school()/match_team() (db/02), in db/39.
 *
 * db/09_rls_policies.sql shipped them as subqueries against `match`, run under
 * the CALLER's row-level security — so a caller who held the table's own
 * capability but could not read the match got a NULL anchor, and app_can()
 * failed closed. tables.mjs now declares the helpers (viaMatch() there); this
 * list is what lets the generator keep emitting db/09 exactly as it shipped,
 * the same discipline as WITHDRAWN_SINCE_01, while db/39 carries the policies
 * as they run.
 *
 * `trip` and `match_squad` are absent on purpose: resolving their anchor would
 * widen what a driver and a granted enquiry read beyond what either role was
 * meant to reach. docs/rls-anchor-audit.md is the audit behind every entry
 * here and every table left out.
 */
export const REANCHORED_IN_39 = Object.freeze([
  "match_toss", "match_broadcast", "drs_review", "match_official",
  "match_pitch_report", "match_weather", "match_availability",
]);
export const REANCHOR_FILE = "39_match_anchor_helpers.sql";

/**
 * A table's definition as db/09 shipped it: the fixture anchors as the
 * subqueries they were, whatever tables.mjs says today.
 * @param {string} table @param {TableDef} def @returns {TableDef}
 */
const asShippedIn09 = (table, def) => (REANCHORED_IN_39.includes(table)
  ? { ...def, anchors: { ...def.anchors,
      school: `(SELECT m.school_id FROM match m WHERE m.id = ${table}.match_id)`,
      team:   `(SELECT m.team_code FROM match m WHERE m.id = ${table}.match_id)` } }
  : def);

/** One table's four DROPs and three policies. @param {string} table @param {TableDef} def */
const tablePolicy = (table, def) => `
-- ${table} — read: ${def.read}${def.readAlso ? ` AND ${def.readAlso}` : ""}${def.readAnchors ? ` (from ${def.readAnchors.length + 1} scopes)` : ""} · write: ${def.write}${def.visibleWhen ? "\n-- plus a named exception on read — see readPredicate() in generate-rls.mjs" : ""}
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
           WITH CHECK (${callCan(table, def, def.write)});`;

function tablePolicies() {
  const out = [banner("Per-table row-level security")];
  for (const [table, def] of Object.entries(TABLES)) {
    out.push(tablePolicy(table, asShippedIn09(table, def)));
    // No DELETE policy anywhere: records about minors are deactivated, never
    // removed, so that an audit trail survives.
  }
  return out.join("\n");
}

function maskViews() {
  const out = [banner("Column-masking views")];
  for (const [table, current] of Object.entries(TABLES)) {
    const def = asShippedIn09(table, current);
    const masked = def.masked ?? {};
    const maskedAnyTeam = def.maskedAnyTeam ?? {};
    if (!Object.keys(masked).length && !Object.keys(maskedAnyTeam).length) continue;

    // column → { capability, team anchor }
    //
    // The TEAM anchor varies per capability, which is what lets one table show
    // more of a row to the people it belongs to and less to everyone else.
    //
    //   masked        — anchored to the row's own team. A coach unmasks their
    //                   own squad and nothing else.
    //   maskedAnyTeam — the team dimension does not apply. Anyone holding the
    //                   capability anywhere in the school reads it, which is
    //                   what a school-wide roster needs: every coach can see
    //                   how old a boy is, and only his own coach can see his
    //                   home address.
    const teamAnchored = anchor(table, def, "team", "text");
    /** @type {Record<string, { cap: string, team: string }>} */
    const guard = {};
    for (const [cap, cols] of Object.entries(masked))
      for (const c of cols) guard[c.toLowerCase()] = { cap, team: teamAnchored };
    for (const [cap, cols] of Object.entries(maskedAnyTeam))
      for (const c of cols) guard[c.toLowerCase()] = { cap, team: ANY.text };

    const pairs = Object.entries(guard)
      .map(([col, g]) => `(${q(col)}, ${q(g.cap)}, ${q(g.team)})`)
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
                            g.team_anchor,
                            ${q(anchor(table, def, "person", "uuid"))},
                            c.column_name, c.column_name)
                ELSE format('%I', c.column_name)
           END, ', ' ORDER BY c.ordinal_position)
    INTO cols
    FROM information_schema.columns c
    LEFT JOIN (VALUES ${pairs}) AS g(column_name, capability, team_anchor)
           ON g.column_name = c.column_name
   WHERE c.table_schema = 'public' AND c.table_name = ${q(table)};

  IF cols IS NULL THEN
    RAISE EXCEPTION 'cannot build ${table}_masked: table ${table} not found (apply 00_schema_core.sql first)';
  END IF;

  EXECUTE format(
    -- security_invoker is the load-bearing word here, and it is easy to read
    -- past. A view runs with the permissions of its OWNER unless told
    -- otherwise, and the owner of this one owns ${table} too — so row-level
    -- security on ${table} was evaluated as a role that bypasses it, and this
    -- view returned EVERY row in the table to anyone who could select from it.
    -- Cross-school, cross-tenant, through the one object the read path is
    -- required to use for personal information. Masking still applied, so a
    -- leaked row had its sensitive columns nulled and looked entirely correct.
    -- security_barrier alone does not help: it controls when predicates may be
    -- pushed down, not whose policies apply.
    'CREATE OR REPLACE VIEW ${table}_masked WITH (security_barrier = true, security_invoker = true) AS SELECT %s FROM ${table}',
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
DROP POLICY IF EXISTS role_assignment_read   ON role_assignment;
DROP POLICY IF EXISTS role_assignment_write  ON role_assignment;
DROP POLICY IF EXISTS role_assignment_revoke ON role_assignment;

CREATE POLICY role_assignment_read ON role_assignment
  FOR SELECT USING (
    person_id = app_user_id()
    OR app_can('user.role.assign', school_id, team_code, NULL, NULL)
  );

-- TWO QUESTIONS ON A GRANT, NOT ONE.
--
-- app_can() asks whether this person may appoint anybody AT THIS SCOPE.
-- app_may_grant() asks whether they may appoint somebody to THIS ROLE. Only
-- the first was ever asked, and the gap was an escalation reachable with a
-- single INSERT: a school administrator holds user.role.assign at their own
-- school, so the check passed for any role at all. They could appoint
-- themselves 'medical' and read their pupils' clinical notes, or appoint
-- themselves 'platformadmin' and — because app_holds() did not look at the
-- assignment's tenant either — move a platform-wide feature switch.
--
-- Both halves are now closed, and deliberately in different places: which
-- roles a granter may hand out is a tenant-level policy question answered by
-- GRANTABLE_ROLES, and whether a platform capability may be held through a
-- school-scoped assignment is a model question answered by PLATFORM_ONLY.
-- Either alone leaves a way round.
CREATE POLICY role_assignment_write ON role_assignment
  FOR INSERT WITH CHECK (
    app_can('user.role.assign', school_id, team_code, NULL, NULL)
    AND app_may_grant(role)
  );

-- REVOKING, which had no policy at all and therefore could not be done.
--
-- That is the quieter half of the same failure. A build you cannot get INTO is
-- the famous kind; a build where a mistaken appointment can be made and never
-- withdrawn is the same shape, and it had been sitting here since the
-- assignment table was written. The only column this may change is the active
-- flag: re-pointing an assignment at a different person or school would be a
-- new appointment wearing an old one's audit trail, so it is refused by the
-- trigger below, and a fresh row is the honest way to do it.
CREATE POLICY role_assignment_revoke ON role_assignment
  FOR UPDATE USING (app_can('user.role.assign', school_id, team_code, NULL, NULL))
           WITH CHECK (app_can('user.role.assign', school_id, team_code, NULL, NULL));

CREATE OR REPLACE FUNCTION role_assignment_revoke_only() RETURNS trigger AS $$
BEGIN
  IF NEW.person_id IS DISTINCT FROM OLD.person_id
  OR NEW.role      IS DISTINCT FROM OLD.role
  OR NEW.school_id IS DISTINCT FROM OLD.school_id
  OR NEW.team_code IS DISTINCT FROM OLD.team_code THEN
    RAISE EXCEPTION 'an assignment may be deactivated, not re-pointed; '
                    'withdraw this one and make the appointment you meant'
      USING ERRCODE = 'check_violation';
  END IF;
  -- The provenance is part of the record, not part of the row's editable
  -- state. Letting an update move created_by would make the audit trail
  -- writable by the people it is about.
  IF NEW.created_by IS DISTINCT FROM OLD.created_by
  OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'who made an appointment and when are not editable'
      USING ERRCODE = 'check_violation';
  END IF;
  -- WITHDRAWING CARRIES A NAME TOO, stamped here rather than supplied. The
  -- gap this closes is the mirror of the one below: an appointment could be
  -- taken back and the row would not say by whom.
  IF OLD.active AND NOT NEW.active THEN
    NEW.revoked_by := app_user_id();
    NEW.revoked_at := now();
  ELSIF NOT OLD.active AND NEW.active THEN
    -- Reactivating is a new appointment wearing an old one's provenance. The
    -- policy already only permits the true-to-false direction; this is the
    -- structural half.
    RAISE EXCEPTION 'a withdrawn assignment is not reactivated; make the appointment again'
      USING ERRCODE = 'check_violation';
  ELSE
    NEW.revoked_by := OLD.revoked_by;
    NEW.revoked_at := OLD.revoked_at;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS role_assignment_revoke_guard ON role_assignment;
CREATE TRIGGER role_assignment_revoke_guard BEFORE UPDATE ON role_assignment
  FOR EACH ROW EXECUTE FUNCTION role_assignment_revoke_only();

/**
 * WHO MADE THIS APPOINTMENT — stamped, never supplied.
 *
 * created_by has been on this table since it was written and NOTHING HAS EVER
 * WRITTEN IT: twenty-five seeded assignments, none with a granter named. A
 * column that exists and is never populated is the same shape as a capability
 * nobody can exercise, and this is the worst place in the schema for it.
 * Every other decision here carries a name — who published a broadcast, who
 * hid a module, who waived an exclusivity, who said a boy could not play — and
 * the appointment that GRANTS ALL OF THOSE POWERS did not.
 *
 * A TRIGGER RATHER THAN A DEFAULT OR A ROUTE, and the difference is the point.
 * A default can be overridden by naming the column; a route can be bypassed by
 * another route, an import, or psql. Forced here, the row cannot claim
 * somebody else made the appointment no matter who writes it or how.
 *
 * NULL stays meaningful: the seed and the migrations insert as the migration
 * user, where app_user_id() is NULL, and "no granter" is the honest answer for
 * a row the platform created rather than a person.
 */
CREATE OR REPLACE FUNCTION role_assignment_stamp_granter() RETURNS trigger AS $$
BEGIN
  NEW.created_by := app_user_id();
  NEW.created_at := now();
  -- A fresh appointment is not withdrawn, whatever the insert claimed.
  NEW.revoked_by := NULL;
  NEW.revoked_at := NULL;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS role_assignment_granter ON role_assignment;
CREATE TRIGGER role_assignment_granter BEFORE INSERT ON role_assignment
  FOR EACH ROW EXECUTE FUNCTION role_assignment_stamp_granter();

ALTER TABLE assignment_subject ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assignment_subject_read ON assignment_subject;
-- guardian.link.manage is here beside user.role.assign because the office
-- has to be able to SEE a child's links to work them — to answer "who is
-- allowed to read this boy's record", to spot the one with no verified link,
-- to end the right one. It reads links; it never grants reach to a child.
CREATE POLICY assignment_subject_read ON assignment_subject
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM role_assignment a
     WHERE a.id = assignment_subject.assignment_id
       AND (a.person_id = app_user_id()
            OR app_can('user.role.assign',    a.school_id, a.team_code, NULL, NULL)
            OR app_can('guardian.link.manage', a.school_id, a.team_code, NULL, NULL))
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
    `-- ${ALL_CAPABILITIES.filter(shippedIn01).length} capabilities across ${ROLES.filter(roleIn01).length} roles.`,
    ``,
    `-- Principal helpers. app_user_id() is set from the signed token on every`,
    `-- request; everything else about a person's authority is looked up.`,
    `CREATE OR REPLACE FUNCTION app_user_id() RETURNS uuid AS $$`,
    `  SELECT nullif(current_setting('app.user_id', true), '')::uuid $$ LANGUAGE sql STABLE;`,
    `CREATE OR REPLACE FUNCTION app_device_id() RETURNS text AS $$`,
    `  SELECT nullif(current_setting('app.device_id', true), '') $$ LANGUAGE sql STABLE;`,
    `CREATE OR REPLACE FUNCTION app_player_id() RETURNS uuid AS $$`,
    `  SELECT nullif(current_setting('app.player_id', true), '')::uuid $$ LANGUAGE sql STABLE;`,
    // The catalogue FIRST. app_holds() joins capability to find out whether a
    // capability belongs to a tenant, and Postgres validates a function body
    // against the tables it names at creation time — so emitting the decision
    // functions before the table they read fails the migration outright.
    capabilityRows(),
    decisionFunction(),
    teamScopedConstraint(),
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
    // Emitted here rather than with the other generated constraints in
    // 01_authz.sql, because these span tables created in 00 AND 08 — and 01
    // runs before 08. Same invariant as the policies themselves: tables first,
    // everything that references them last.
    teamCodeConstraints(),
    tablePolicies(),
    maskViews(),
    ``,
  ].join("\n");
}

/**
 * The decision functions as they RUN: db/01's three, re-emitted with the hour
 * hand (see `liveness` above). Applied after db/22, which adds the column
 * they read — Postgres validates a SQL function's body against the tables it
 * names at creation time, so the order is not optional.
 */
export function timeBox() {
  return [
    `-- ══════════════════════════════════════════════════════════════════`,
    `--  23 · The hour hand on an assignment (SCRBRD-012)`,
    `-- ══════════════════════════════════════════════════════════════════`,
    `-- GENERATED from packages/policy/ by services/api/rls/generate-rls.mjs — DO NOT EDIT BY HAND.`,
    `-- Regenerate with \`pnpm rls:generate\`. Companion: db/01_authz.sql, which`,
    `-- stays exactly as it shipped; this file is the same three functions with`,
    `-- one more line in their liveness rule:`,
    `--`,
    `--     AND (a.expires_at IS NULL OR a.expires_at > now())`,
    `--`,
    `-- role_assignment.expires_at (db/22) is NULL for every ordinary appointment,`,
    `-- so nothing here changes for anyone but a support assignment — which is`,
    `-- live for the minutes it was issued for and not one second longer, decided`,
    `-- by the same functions on every statement, with no job to run and fail.`,
    ``,
    decisionFunction({ timeBoxed: true }),
    mayGrantFunction({ timeBoxed: true }),
    ``,
  ].join("\n");
}

/**
 * The decision functions as they run from db/35 on: db/23's, plus the pause on
 * a suspended duty (see SUSPENSION above). Applied after db/34, which creates
 * the duty_suspension table these bodies read.
 *
 * Ends in its own DO $check$ like every hand-written migration, and the check
 * is generated too: it asks the catalogue whether the functions that were just
 * created really read the suspension, really run as definer, and really carry
 * the pinned search_path — so a paste that half-applied, or a later file that
 * re-emitted them without the line, cannot pass for this one.
 */
export function suspension() {
  const fns = ["app_can(text,uuid,text,uuid,uuid)", "app_holds(text)", "app_may_grant(text)"];
  return [
    `-- ══════════════════════════════════════════════════════════════════`,
    `--  35 · A suspended duty grants nothing (SCRBRD-034)`,
    `-- ══════════════════════════════════════════════════════════════════`,
    `-- GENERATED from packages/policy/ by services/api/rls/generate-rls.mjs — DO NOT EDIT BY HAND.`,
    `-- Regenerate with \`pnpm rls:generate\`. Companions: db/01_authz.sql and`,
    `-- db/23_authz_time_box.sql, which stay exactly as they shipped; this file is`,
    `-- db/23's three functions with one more condition in their liveness rule:`,
    `--`,
    `--     AND NOT EXISTS (SELECT 1 FROM duty_suspension s`,
    `--                      WHERE s.assignment_id = a.id AND s.lifted_at IS NULL)`,
    `--`,
    `-- duty_suspension (db/34) holds a row only for an assignment the school`,
    `-- office linked to a match duty and then suspended, with a reason. While`,
    `-- that row is open the assignment is not live — to app_can(), app_holds()`,
    `-- and app_may_grant() alike — and lifting it (another reason, another name)`,
    `-- makes it live again without touching role_assignment.active, which db/01`,
    `-- never lets go from false back to true. Every other assignment has no row`,
    `-- there, so nothing changes for anybody else.`,
    ``,
    decisionFunction({ timeBoxed: true, suspendable: true }),
    mayGrantFunction({ timeBoxed: true, suspendable: true }),
    ``,
    `-- ── Assertion ──────────────────────────────────────────────────────`,
    `DO $check$`,
    `DECLARE`,
    `  f   text;`,
    `  o   oid;`,
    `BEGIN`,
    `  FOREACH f IN ARRAY ARRAY[${fns.map(q).join(", ")}] LOOP`,
    `    o := to_regprocedure(f);`,
    `    IF o IS NULL THEN`,
    `      RAISE EXCEPTION 'db/35: % is missing', f;`,
    `    END IF;`,
    `    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = o) THEN`,
    `      RAISE EXCEPTION 'db/35: % is no longer SECURITY DEFINER', f;`,
    `    END IF;`,
    `    IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(coalesce(p.proconfig, '{}')) c`,
    `                    WHERE p.oid = o AND c = 'search_path=pg_catalog, public, pg_temp') THEN`,
    `      RAISE EXCEPTION 'db/35: % does not pin its search_path', f;`,
    `    END IF;`,
    `    IF (SELECT prosrc FROM pg_proc WHERE oid = o) NOT LIKE '%duty_suspension s%s.lifted_at IS NULL%' THEN`,
    `      RAISE EXCEPTION 'db/35: % does not read the suspension', f;`,
    `    END IF;`,
    `    IF (SELECT prosrc FROM pg_proc WHERE oid = o) NOT LIKE '%a.expires_at IS NULL OR a.expires_at > now()%' THEN`,
    `      RAISE EXCEPTION 'db/35: % lost db/23''s hour hand', f;`,
    `    END IF;`,
    `  END LOOP;`,
    `END $check$;`,
    ``,
  ].join("\n");
}

/**
 * The fixture-anchored policies as they run from db/39 on: db/09's template,
 * with the school and team anchors read through match_school()/match_team()
 * instead of a subquery under the caller's RLS. Only REANCHORED_IN_39; every
 * other policy stays exactly as db/09 made it.
 *
 * Ends in a generated DO $check$ like db/35: it asks pg_policies whether each
 * of the policies just created really reads the helpers and no longer reads
 * `match` directly — so a paste that half-applied, or a later file that put
 * the subquery back, cannot pass for this one.
 */
export function matchAnchors() {
  const policiesOf = REANCHORED_IN_39.flatMap((t) => [`${t}_read`, `${t}_insert`, `${t}_update`]);
  return [
    `-- ══════════════════════════════════════════════════════════════════`,
    `--  39 · Fixture anchors through match_school() / match_team()`,
    `-- ══════════════════════════════════════════════════════════════════`,
    `-- GENERATED from packages/policy/ by services/api/rls/generate-rls.mjs — DO NOT EDIT BY HAND.`,
    `-- Regenerate with \`pnpm rls:generate\`. Companion: db/09_rls_policies.sql, which`,
    `-- stays exactly as it shipped; this file re-creates ${REANCHORED_IN_39.length} of its tables' policies`,
    `-- with one change. Their school and team anchors were subqueries against`,
    `-- \`match\`, run under the CALLER's row-level security:`,
    `--`,
    `--     (SELECT m.school_id FROM match m WHERE m.id = <table>.match_id)`,
    `--`,
    `-- and are now the SECURITY DEFINER helpers db/02 built for the scoring tables:`,
    `--`,
    `--     match_school(<table>.match_id), match_team(<table>.match_id)`,
    `--`,
    `-- The anchor is metadata; app_can() still decides every row. What changes is`,
    `-- only that a caller who holds the table's capability but cannot read the`,
    `-- match itself no longer gets a NULL anchor and a silent refusal. The audit`,
    `-- that decides which tables that is safe for is docs/rls-anchor-audit.md:`,
    `--`,
    `--   match_toss, match_broadcast, drs_review, match_official,`,
    `--   match_pitch_report, match_weather — no role's access changes. Each is`,
    `--   read under fixture.read, which IS the match's own read check, and every`,
    `--   role holding their write capability also holds fixture.read in the same`,
    `--   bundle. Converted so the anchor stops depending on which OTHER`,
    `--   assignments a person happens to hold.`,
    `--`,
    `--   match_availability — a pupil's selfaccess assignment holds`,
    `--   availability.read and .declare but not fixture.read, so a boy called up`,
    `--   to a side his team assignment cannot see could neither read nor make his`,
    `--   OWN statement about that fixture. Now he can, for his own row only: the`,
    `--   person anchor is unchanged and still decides whose row it is.`,
    `--`,
    `-- NOT HERE, on purpose: trip (a driver would read every trip at the school,`,
    `-- not his own) and match_squad (a granted enquiry would read which of another`,
    `-- side's fixtures a boy is named for). Both wait on a narrower rule the`,
    `-- audit proposes.`,
    ``,
    ...REANCHORED_IN_39.map((t) => tablePolicy(t, TABLES[t])),
    ``,
    `-- ── Assertion ──────────────────────────────────────────────────────`,
    `DO $check$`,
    `DECLARE`,
    `  p   text;`,
    `  r   record;`,
    `BEGIN`,
    `  FOREACH p IN ARRAY ARRAY[${policiesOf.map(q).join(", ")}] LOOP`,
    `    SELECT coalesce(qual, '') || ' ' || coalesce(with_check, '') AS body INTO r`,
    `      FROM pg_policies WHERE schemaname = 'public' AND policyname = p;`,
    `    IF NOT FOUND THEN`,
    `      RAISE EXCEPTION 'db/39: policy % is missing', p;`,
    `    END IF;`,
    `    IF r.body NOT LIKE '%match_school(%' OR r.body NOT LIKE '%match_team(%' THEN`,
    `      RAISE EXCEPTION 'db/39: policy % does not anchor through match_school()/match_team()', p;`,
    `    END IF;`,
    `    IF r.body LIKE '%FROM match %' THEN`,
    `      RAISE EXCEPTION 'db/39: policy % still reads match under the caller''s RLS', p;`,
    `    END IF;`,
    `  END LOOP;`,
    `  -- The helpers must still be what db/02 and db/16 made them: definer, pinned.`,
    `  FOREACH p IN ARRAY ARRAY['match_school(uuid)', 'match_team(uuid)'] LOOP`,
    `    IF NOT coalesce((SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure(p)), false) THEN`,
    `      RAISE EXCEPTION 'db/39: % is missing or no longer SECURITY DEFINER', p;`,
    `    END IF;`,
    `    IF NOT EXISTS (SELECT 1 FROM pg_proc f, unnest(coalesce(f.proconfig, '{}')) c`,
    `                    WHERE f.oid = to_regprocedure(p) AND c = 'search_path=pg_catalog, public, pg_temp') THEN`,
    `      RAISE EXCEPTION 'db/39: % does not pin its search_path', p;`,
    `    END IF;`,
    `  END LOOP;`,
    `END $check$;`,
    ``,
  ].join("\n");
}

/** Backwards-compatible single string, for the drift tests. */
export function main() { return authz() + "\n" + policies(); }

if (import.meta.url === `file://${process.argv[1]}`) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync("db/01_authz.sql", authz());
  writeFileSync("db/09_rls_policies.sql", policies());
  writeFileSync("db/23_authz_time_box.sql", timeBox());
  writeFileSync("db/35_authz_suspension.sql", suspension());
  writeFileSync(`db/${REANCHOR_FILE}`, matchAnchors());
  console.log(`wrote db/01_authz.sql, db/09_rls_policies.sql, db/23_authz_time_box.sql, db/35_authz_suspension.sql and db/${REANCHOR_FILE}`);
}

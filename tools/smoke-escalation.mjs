#!/usr/bin/env node
/**
 * The two ways an authorization model dies, and the guards against both.
 *
 * WHY THIS WALK EXISTS. A previous SCRBRD build was lost to its own permission
 * model. Its rules asked hasRole('System Architect') while the data stored
 * SYSTEM_ARCHITECT, so every check was permanently false, every write was
 * denied, and the one account that could have repaired it was gated behind the
 * same check. Nobody could get back in. Separately, that build let a person
 * write their own roles array, so anybody signed in could have made themselves
 * an administrator.
 *
 * Those are the two directions, and they are not opposites — they are the same
 * mistake seen from either side: a permission check nobody verified against
 * reality. So this walk asserts both.
 *
 *   UP    Nobody may appoint themselves to a role they were not given.
 *   OUT   Every legitimate appointment still works, every mistake can be
 *         withdrawn, and there is a way back in from outside a school.
 *
 * Both matter equally. A guard that closes the escalation and also stops a
 * school administrator appointing a coach has not made anybody safer; it has
 * moved the failure from one column to the other.
 *
 *   node tools/migrate.mjs --reset --seed
 *   node tools/smoke-escalation.mjs
 */
import pg from "pg";

const DB = process.env.DATABASE_URL || "postgres://scrbrd:scrbrd@127.0.0.1:5432/scrbrd";
const HIL = "11111111-1111-1111-1111-111111111111";
const WES = "22222222-2222-2222-2222-222222222222";

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log("  ✗", n); } };
const group = (t) => console.log("\n" + t);

const pool = new pg.Pool({ connectionString: DB });
const q = async (t, p) => (await pool.query(t, p)).rows;

/**
 * Run a statement as the APPLICATION role under one person's identity.
 *
 * Not as the migration user. Every probe here has to travel the path a request
 * travels, because row-level security is inert for a superuser and a walk that
 * forgot to drop role would pass while proving nothing.
 */
async function asPerson(personId, sql, params = []) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL ROLE scrbrd_app");
    await c.query("SELECT set_config('app.user_id', $1, true)", [personId]);
    const r = await c.query(sql, params);
    await c.query("ROLLBACK");
    return { ok: true, rows: r.rows, count: r.rowCount };
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    return { ok: false, code: e.code, message: e.message };
  } finally { c.release(); }
}

/**
 * Several statements, one principal, one transaction — result of the last.
 *
 * asPerson() runs a single query and rolls back, which makes a lifecycle
 * (appoint, then withdraw, then read it back) impossible to express: each call
 * undoes the one before. Wrapping them in a data-modifying CTE does not work
 * either, and for a reason worth writing down — every CTE in one statement
 * sees the SAME SNAPSHOT, so an UPDATE cannot find the row an INSERT beside it
 * has just written. It returned nought rows and looked like a policy refusal.
 */
async function asPersonSeq(personId, statements) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL ROLE scrbrd_app");
    await c.query("SELECT set_config('app.user_id', $1, true)", [personId]);
    let last = { rows: [], rowCount: 0 };
    for (const [sql, params] of statements) last = await c.query(sql, params ?? []);
    await c.query("ROLLBACK");
    return { ok: true, rows: last.rows, count: last.rowCount };
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    return { ok: false, code: e.code, message: e.message };
  } finally { c.release(); }
}

const REFUSED = (r) => r.ok === false || r.count === 0;
const ALLOWED = (r) => r.ok === true && r.count > 0;

try {
  const who = Object.fromEntries((await q(
    `select email, id from app_user where email in
      ('registrar@example.invalid','platform@example.invalid','sarah@example.invalid',
       'coach@example.invalid','medical@example.invalid','parent@example.invalid')`))
    .map((r) => [r.email.split("@")[0], r.id]));

  const grant = (actor, target, role, school, team = null) => asPerson(actor,
    `insert into role_assignment (person_id, role, school_id, team_code)
     values ($1,$2,$3,$4) returning id`, [target, role, school, team]);

  // ── UP ────────────────────────────────────────────────────────────
  group("Nobody appoints themselves upward");
  {
    // The school office holds user.role.assign at its own school, which used
    // to be the only question the policy asked. These four are what that
    // bought before app_may_grant() existed.
    for (const [role, what] of [
      ["platformadmin", "the platform itself"],
      ["medical",       "children's clinical notes"],
      ["finance",       "sponsorship contract values"],
      ["principal",     "the school's own leadership"],
    ]) {
      ok(`a school administrator cannot appoint themselves ${role} — ${what}`,
         REFUSED(await grant(who.registrar, who.registrar, role, HIL)));
    }
    // The same refusal for somebody else, not just for themselves. "You may
    // not promote yourself" would be a rule about identity; this is a rule
    // about what the role may hand out, and it holds whoever the target is.
    ok("...nor appoint ANYBODY to them",
       REFUSED(await grant(who.registrar, who.coach, "medical", HIL)));

    // A platform assignment belongs to no school, and a school-scoped grantor
    // has no scope that reaches it.
    ok("nor create a platform-scoped assignment at all",
       REFUSED(await grant(who.registrar, who.registrar, "platformadmin", null)));

    // Roles with no granting capability at all.
    ok("a director of sport cannot appoint a school administrator",
       REFUSED(await grant(who.sarah, who.sarah, "schooladmin", HIL)));
    ok("a coach cannot appoint anybody",
       REFUSED(await grant(who.coach, who.coach, "coach", HIL, "1XI")));
    ok("nor can a parent",
       REFUSED(await grant(who.parent, who.parent, "spectator", HIL)));
    ok("nor another school's office reach into this one",
       REFUSED(await grant(
         (await q(`select id from app_user where email='registrar.wes@example.invalid'`))[0].id,
         who.coach, "coach", HIL, "1XI")));
  }

  group("A platform capability is not held through a school");
  {
    // THE AMPLIFIER, asserted directly. app_holds() answers the tenant-less
    // questions — moving a platform feature switch, accrediting a scout — and
    // it used not to look at whether the ASSIGNMENT had a tenant. One row
    // appointing yourself platformadmin AT YOUR OWN SCHOOL then answered true.
    //
    // Written straight into the table as the migration user, bypassing the
    // policy that now refuses it, because the question here is what app_holds()
    // does with such a row and not whether the row can be created.
    const a = (await q(
      `insert into role_assignment (person_id, role, school_id)
       values ($1,'platformadmin',$2) returning id`, [who.registrar, HIL]))[0].id;
    try {
      const r = await asPerson(who.registrar,
        `select app_holds('platform.feature.manage') as f,
                app_holds('platform.tenant.manage')  as t,
                app_holds('scouting.accredit')       as s`);
      ok("a school-scoped platformadmin holds no platform capability",
         r.rows[0].f === false && r.rows[0].t === false && r.rows[0].s === false);
      // And therefore cannot reach the thing the capability guards.
      ok("...and cannot move a platform-wide switch",
         REFUSED(await asPerson(who.registrar,
           `update feature_flag set enabled = true, locked = false
             where key = 'drs_review' returning key`)));
      // The platform account, whose assignment has no school, still can.
      ok("the platform account still can",
         (await asPerson(who.platform, `select app_holds('platform.feature.manage') as f`))
           .rows[0].f === true);
    } finally {
      await q(`delete from role_assignment where id = $1`, [a]);
    }
  }

  // ── OUT ───────────────────────────────────────────────────────────
  group("Every appointment a school actually makes still works");
  {
    // If any of these fail the guard has become the lockout it was meant to
    // prevent. A school office that cannot appoint a coach is a school office
    // that will be given a database password instead.
    for (const role of ["coach", "assistantcoach", "teammanager", "scorer",
                        "official", "player", "guardian", "spectator", "driver"]) {
      ok(`a school administrator can appoint a ${role}`,
         ALLOWED(await grant(who.registrar, who.coach, role, HIL,
                             ["coach", "assistantcoach", "teammanager"].includes(role) ? "U15A" : null)));
    }
    ok("a director of sport can appoint a physiotherapist",
       ALLOWED(await grant(who.sarah, who.coach, "medical", HIL)));
  }

  group("A mistake can be withdrawn");
  {
    // The quieter half of the same failure, and it had no policy at all: an
    // appointment could be made and never taken back through the application.
    const made = await asPerson(who.registrar,
      `insert into role_assignment (person_id, role, school_id, team_code)
       values ($1,'coach',$2,'U15A') returning id`, [who.parent, HIL]);
    ok("the appointment is made", ALLOWED(made));

    // In its own transaction, since asPerson rolls back.
    const id = (await q(
      `insert into role_assignment (person_id, role, school_id, team_code)
       values ($1,'coach',$2,'U14A') returning id`, [who.parent, HIL]))[0].id;
    try {
      ok("...and can be withdrawn",
         ALLOWED(await asPerson(who.registrar,
           `update role_assignment set active = false where id = $1 returning id`, [id])));
      // Withdrawing is not deleting. The row stays, so who appointed whom and
      // when survives — the same rule as everywhere else in this schema.
      ok("...leaving the record of it behind",
         (await q(`select count(*)::int c from role_assignment where id = $1`, [id]))[0].c === 1);
      ok("re-pointing it at another school is refused instead",
         REFUSED(await asPerson(who.registrar,
           `update role_assignment set school_id = $2 where id = $1 returning id`, [id, WES])));
      ok("...and at another person",
         REFUSED(await asPerson(who.registrar,
           `update role_assignment set person_id = $2 where id = $1 returning id`,
           [id, who.coach])));
    } finally {
      await q(`delete from role_assignment where id = $1`, [id]);
    }
  }

  group("There is a way back in");
  {
    // The lockout guard. Somebody outside every school must be able to repair
    // a school that has locked itself out, and that somebody holds an
    // assignment nobody inside a school can create.
    ok("the platform account can appoint a school administrator",
       ALLOWED(await grant(who.platform, who.coach, "schooladmin", HIL)));
    ok("...and any role in the model",
       ALLOWED(await grant(who.platform, who.coach, "medical", HIL)));
    ok("...at a school it holds no assignment at",
       ALLOWED(await grant(who.platform, who.coach, "schooladmin", WES)));
    ok("its own assignment belongs to no school",
       (await q(`select school_id from role_assignment
                  where person_id = $1 and role = 'platformadmin'`, [who.platform]))[0]
         .school_id === null);
    // Every role must be appointable by somebody. A role in the model that
    // nobody can hand out is a feature that can never be switched on.
    const orphaned = await q(
      `select r.role from (select distinct role from role_capability) r
        where not exists (select 1 from role_grantable g where g.role = r.role)`);
    ok("no role in the model is unappointable",
       orphaned.length === 0 || (console.log("     unappointable:", orphaned.map(o=>o.role).join(", ")), false));
  }

  group("Every appointment carries the name of whoever made it");
  {
    // created_by has been on role_assignment since it was written and NOTHING
    // HAD EVER WRITTEN IT — twenty-five seeded assignments, none with a
    // granter. A column that exists and is never populated is the same shape
    // as a capability nobody can exercise, and this was the worst place in the
    // schema for it: the appointment that grants every other power was the one
    // decision with no name on it.
    const made = (await q(
      `insert into role_assignment (person_id, role, school_id) values ($1,'spectator',$2)
       returning id`, [who.coach, HIL]))[0].id;
    try {
      // Seeded and migration-written rows have no granter, and that is the
      // honest answer rather than a gap: app_user_id() is NULL for the
      // migration user, and the platform did make those appointments.
      ok("a row the platform seeded names no granter",
         (await q(`select created_by from role_assignment where id = $1`, [made]))[0]
           .created_by === null);
    } finally { await q(`delete from role_assignment where id = $1`, [made]); }

    const byOffice = await asPerson(who.registrar,
      `insert into role_assignment (person_id, role, school_id, team_code)
       values ($1,'coach',$2,'U15A') returning created_by, created_at`, [who.parent, HIL]);
    ok("an appointment made by a person names them",
       byOffice.rows?.[0]?.created_by === who.registrar);
    ok("...and stamps when", !!byOffice.rows?.[0]?.created_at);

    // STAMPED, NEVER SUPPLIED. A default could be overridden by naming the
    // column; a route could be bypassed by another route, an import, or psql.
    const spoofed = await asPerson(who.registrar,
      `insert into role_assignment (person_id, role, school_id, team_code, created_by)
       values ($1,'coach',$2,'U15B',$3) returning created_by`,
      [who.parent, HIL, who.coach]);
    ok("naming somebody else as the granter does not work",
       spoofed.rows?.[0]?.created_by === who.registrar);

    // Withdrawing is the more consequential half and had no name at all.
    //
    // ONE TRANSACTION, because asPerson() rolls back — chaining separate calls
    // undoes each statement before the next runs, so the "reactivation" test
    // was setting active true on a row that had never gone false and the
    // "granter's name" test was reading rows that had been rolled away. Both
    // reported bugs in code that was correct.
    const life = await asPersonSeq(who.registrar, [
      [`insert into role_assignment (person_id, role, school_id, team_code)
        values ($1,'coach',$2,'U16A')`, [who.parent, HIL]],
      [`update role_assignment set active = false
         where person_id = $1 and role = 'coach' and team_code = 'U16A'`, [who.parent]],
      [`select a.created_by, a.revoked_by, a.revoked_at is not null as stamped,
               g.name as granted_by_name, r.name as revoked_by_name
          from role_assignment a
          left join app_user g on g.id = a.created_by
          left join app_user r on r.id = a.revoked_by
         where a.person_id = $1 and a.role = 'coach' and a.team_code = 'U16A'`, [who.parent]],
    ]);
    ok("an appointment and its withdrawal both land",
       life.ok === true && life.rows.length === 1);
    ok("...the appointment names its granter", life.rows?.[0]?.created_by === who.registrar);
    ok("...the withdrawal names who took it back", life.rows?.[0]?.revoked_by === who.registrar);
    ok("...and stamps when", life.rows?.[0]?.stamped === true);
    // Reachable, not merely stored: a name rather than a pair of uuids.
    ok("the read surfaces the granter's name, not an id",
       life.rows?.[0]?.granted_by_name === "B Naicker");
    ok("...and the revoker's", life.rows?.[0]?.revoked_by_name === "B Naicker");

    const id = (await q(
      `insert into role_assignment (person_id, role, school_id, team_code)
       values ($1,'coach',$2,'U14B') returning id`, [who.parent, HIL]))[0].id;
    try {
      ok("the provenance is not editable",
         REFUSED(await asPerson(who.registrar,
           `update role_assignment set created_by = $2 where id = $1 returning id`,
           [id, who.coach])));
      // A withdrawn appointment is not reactivated: that would be a new
      // appointment wearing an old one's provenance. Both statements in one
      // transaction, for the reason above.
      ok("...and a withdrawn appointment is not reactivated",
         REFUSED(await asPersonSeq(who.registrar, [
           [`update role_assignment set active = false where id = $1`, [id]],
           [`update role_assignment set active = true where id = $1 returning id`, [id]],
         ])));
    } finally { await q(`delete from role_assignment where id = $1`, [id]); }
  }

  group("The catalogue cannot rot, and cannot be rewritten");
  {
    // THE EXACT MECHANISM THE PREVIOUS BUILD DIED OF: a permission check
    // comparing against a value that is not in the data. A foreign key turns
    // that from a silent permanent denial into a failed migration.
    let typo = null;
    try {
      await q(`insert into role_capability (role, capability)
               values ('coach','platfrom.feature.manage')`);
    } catch (e) { typo = e.code; }
    ok("a misspelt capability is refused by the catalogue", typo === "23503");

    // Belt and braces on the table that decides what every role can do.
    for (const t of ["capability", "role_capability", "role_grantable"]) {
      const privs = (await q(
        `select privilege_type from information_schema.table_privileges
          where grantee = 'scrbrd_app' and table_name = $1`, [t])).map((r) => r.privilege_type);
      ok(`${t} is read-only to the application`,
         privs.length > 0 && privs.every((p) => p === "SELECT"));
    }
    ok("...and row-level security says the same",
       (await q(`select count(*)::int c from pg_policies
                  where tablename in ('capability','role_capability','role_grantable')
                    and cmd <> 'SELECT'`))[0].c === 0);
  }

} catch (e) {
  fail++; console.log("\n  ✗ threw:", e.message);
} finally {
  await pool.end().catch(() => {});
  console.log("\n" + "─".repeat(52));
  console.log(`ESCALATION SMOKE: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
